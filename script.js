
// App de Vistoria — versão sem build (React via CDN)
// Agora com IndexedDB (Dexie) para fotos como Blobs,
// exifr para orientação EXIF e html2pdf para PDF.

const { useState, useEffect, useRef } = React;

/* =========================
   0) CONFIGURAÇÕES GERAIS
   ========================= */
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // 2,5 MB
const MAX_SIDE_PX = 1920;                  // lado maior
const JPEG_START_QUALITY = 0.85;
const JPEG_MIN_QUALITY = 0.60;
const PROCESS_TIMEOUT_MS = 8000;           // 8s
const LOGO_PATH = './assets/logo.png';     // caminho do logo

/* =========================
   1) INDEXEDDB (Dexie)
   ========================= */
const db = new Dexie('imobrotas_db');
db.version(1).stores({
  // Armazenamos APENAS fotos aqui (blobs) — metadados pequenos ficam no localStorage (já existente)
  fotos: 'id, itemId, createdAt'
});

// Salva Blob no IndexedDB e retorna o id gerado.
async function savePhotoBlob(itemId, blob, mime = 'image/jpeg') {
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('f' + Date.now() + Math.random().toString(16).slice(2));
  await db.fotos.put({ id, itemId, mime, size: blob.size, createdAt: Date.now(), blob });
  return id;
}

async function getPhotoBlob(id) {
  const rec = await db.fotos.get(id);
  return rec ? rec.blob : null;
}

async function deletePhotoBlob(id) {
  await db.fotos.delete(id);
}

/* =========================
   2) UTILITÁRIOS DE IMAGEM
   ========================= */
// Lê arquivo em <img>
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Falha ao ler arquivo.'));
    fr.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Imagem inválida.'));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// Converte canvas para Blob (JPEG) com qualidade definida
function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Falha ao exportar imagem.')),
      'image/jpeg',
      quality
    );
  });
}

// Aplica transformações de orientação EXIF no contexto do canvas
function applyExifTransform(ctx, orientation, width, height) {
  // Referência prática — cobre os 8 casos mais comuns
  switch (orientation) {
    case 2: // horizontal flip
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3: // 180°
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4: // vertical flip
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5: // transpose (flip + rotate 90° CW)
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6: // rotate 90° CW
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7: // transverse (flip + rotate 270°)
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8: // rotate 270° CCW
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
    case 1:
    default:
      // Sem transformação
      break;
  }
}

/**
 * Processa a imagem:
 * - Lê EXIF / corrige orientação
 * - Redimensiona para lado maior <= MAX_SIDE_PX
 * - Comprime até ficar <= MAX_IMAGE_BYTES (ou atinge JPEG_MIN_QUALITY)
 * - Timeout de segurança (PROCESS_TIMEOUT_MS)
 * Retorna Blob JPEG; se falhar, lança erro para ativar fallback (pular).
 */
async function processarImagem(file, {
  maxBytes = MAX_IMAGE_BYTES,
  maxSide = MAX_SIDE_PX,
  startQuality = JPEG_START_QUALITY,
  minQuality = JPEG_MIN_QUALITY,
  timeoutMs = PROCESS_TIMEOUT_MS
} = {}) {

  // Timeout de segurança
  const withTimeout = (p) => Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  return await withTimeout((async () => {
    const orientation = await exifr.orientation(file).catch(() => 1) || 1;
    const img = await fileToImage(file);

    // Tamanho original
    let sw = img.naturalWidth || img.width;
    let sh = img.naturalHeight || img.height;

    // Escala inicial para caber no maxSide
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    let tw = Math.round(sw * scale);
    let th = Math.round(sh * scale);

    // Canvas alvo (considera rotações 90º que trocam largura/altura)
    const rotate90 = (orientation >= 5 && orientation <= 8);
    let cw = rotate90 ? th : tw;
    let ch = rotate90 ? tw : th;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Função para (re)desenhar conforme orientação e tamanho atuais
    async function redrawAndExport(quality) {
      const rotate90Now = (orientation >= 5 && orientation <= 8);
      canvas.width = rotate90Now ? th : tw;
      canvas.height = rotate90Now ? tw : th;
      ctx.save();
      applyExifTransform(ctx, orientation, canvas.width, canvas.height);

      // Casos 5 e 7 precisam de draw compensado no eixo Y
      if (orientation === 5) {
        ctx.drawImage(img, 0, -th, tw, th);
      } else if (orientation === 7) {
        ctx.drawImage(img, -tw, 0, tw, th);
      } else {
        ctx.drawImage(img, 0, 0, tw, th);
      }
      ctx.restore();

      const blob = await canvasToBlob(canvas, quality);
      return blob;
    }

    let quality = startQuality;
    let blob = await redrawAndExport(quality);

    // Se ainda passou do limite, reduz qualidade até o mínimo
    while (blob.size > maxBytes && quality > minQuality) {
      quality = Math.max(minQuality, +(quality - 0.05).toFixed(2));
      blob = await redrawAndExport(quality);
    }

    // Se ainda está grande, reduzir dimensões progressivamente
    while (blob.size > maxBytes && (tw > 1280 || th > 1280)) {
      // Reduz 10% cada ciclo
      tw = Math.round(tw * 0.9);
      th = Math.round(th * 0.9);
      blob = await redrawAndExport(quality);
      if (quality > minQuality && blob.size > maxBytes) {
        quality = Math.max(minQuality, +(quality - 0.05).toFixed(2));
        blob = await redrawAndExport(quality);
      }
    }

    if (blob.size > maxBytes) {
      // Ainda grande -> falha para acionar fallback: pular
      throw new Error('imagem_maior_que_limite');
    }

    return blob;
  })());
}

/* =========================
   3) COMPONENTE: GRID DE FOTOS
   ========================= */
// Componente para renderizar fotos (tanto Base64 legado quanto IDs do IndexedDB)
function FotoGrid({ item, onRemoveBase64, onRemoveId }) {
  const [urls, setUrls] = useState([]); // { id?, url, origem: 'idb'|'base64' }
  const urlsRef = useRef([]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      // Revoga URLs anteriores
      urlsRef.current.forEach(u => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); });
      urlsRef.current = [];

      const list = [];

      // 1) Fotos legado em Base64, se existirem
      if (Array.isArray(item.fotos) && item.fotos.length > 0) {
        item.fotos.forEach((dataUrl, idx) => {
          list.push({ key: `b64-${idx}`, url: dataUrl, origem: 'base64' });
        });
      }

      // 2) Fotos novas por IDs do IndexedDB
      if (Array.isArray(item.fotoIds) && item.fotoIds.length > 0) {
        for (const id of item.fotoIds) {
          const blob = await getPhotoBlob(id);
          if (blob) {
            const url = URL.createObjectURL(blob);
            urlsRef.current.push(url);
            list.push({ key: id, id, url, origem: 'idb' });
          }
        }
      }

      if (isMounted) setUrls(list);
    }

    load();
    return () => {
      isMounted = false;
      urlsRef.current.forEach(u => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); });
      urlsRef.current = [];
    };
  }, [item.fotos, item.fotoIds]);

  if (urls.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      {urls.map((foto, idx) => (
        <div key={foto.key} className="relative">
          <img
            src={foto.url}
            className="w-full h-32 object-cover rounded-lg"
            alt={`Foto ${idx + 1}`}
            loading="lazy"
          />
          <button
            onClick={() => {
              if (foto.origem === 'base64') onRemoveBase64(idx);
              else if (foto.origem === 'idb' && foto.id) onRemoveId(foto.id);
            }}
            className="absolute top-1 right-1 bg-red-600 text-white px-2 py-1 rounded-full hover:bg-red-700 active:bg-red-800"
            title="Remover foto"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/* =========================
   4) APP PRINCIPAL
   ========================= */
function VistoriaApp() {
  const [vistorias, setVistorias] = useState([]);
  const [vistoriaAtual, setVistoriaAtual] = useState(null);
  const [tela, setTela] = useState('lista');
  const [salvando, setSalvando] = useState(false);
  const [gerandoPDF, setGerandoPDF] = useState(false);

  // Carregar vistorias ao iniciar (mantemos localStorage para metadados)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vistorias_imoveis');
      if (saved) {
        const parsed = JSON.parse(saved);
        setVistorias(Array.isArray(parsed) ? parsed : []);
      }
    } catch (e) {
      console.error('Erro ao carregar vistorias:', e);
      setVistorias([]);
    }
  }, []);

  // Salvar automaticamente quando vistorias mudam
  useEffect(() => {
    try {
      localStorage.setItem('vistorias_imoveis', JSON.stringify(vistorias));
    } catch (e) {
      console.error('Erro ao salvar:', e);
      alert('Erro ao salvar dados. Tente liberar espaço no dispositivo.');
    }
  }, [vistorias]);

  // Auto-salvar rascunho da vistoria atual
  useEffect(() => {
    if (vistoriaAtual && tela === 'nova') {
      try {
        localStorage.setItem('vistoria_rascunho', JSON.stringify(vistoriaAtual));
      } catch (e) {
        console.error('Erro ao salvar rascunho:', e);
      }
    }
  }, [vistoriaAtual, tela]);

  const novaVistoria = () => {
    try {
      const rascunho = localStorage.getItem('vistoria_rascunho');
      if (rascunho) {
        if (confirm('Existe um rascunho salvo. Deseja recuperá-lo?')) {
          setVistoriaAtual(JSON.parse(rascunho));
          setTela('nova');
          return;
        }
      }
    } catch (e) {
      console.error('Erro ao recuperar rascunho:', e);
    }
    setVistoriaAtual({
      id: Date.now(),
      data: new Date().toISOString().split('T')[0],
      endereco: '',
      tipo: 'entrada',
      responsavel: '',
      itens: [] // cada item: { id, comodo, descricao, estado, fotos? (legado), fotoIds: [] }
    });
    setTela('nova');
  };

  const salvarVistoria = () => {
    if (!vistoriaAtual.endereco.trim()) {
      alert('Por favor, preencha o endereço do imóvel');
      return;
    }
    setSalvando(true);
    try {
      const novasVistorias = [...vistorias];
      const idx = novasVistorias.findIndex(v => v.id === vistoriaAtual.id);
      if (idx >= 0) novasVistorias[idx] = { ...vistoriaAtual };
      else novasVistorias.push({ ...vistoriaAtual });

      setVistorias(novasVistorias);
      localStorage.removeItem('vistoria_rascunho');
      setTimeout(() => {
        setSalvando(false);
        setTela('lista');
        setVistoriaAtual(null);
        alert('Vistoria salva com sucesso!');
      }, 300);
    } catch (e) {
      setSalvando(false);
      alert('Erro ao salvar vistoria: ' + e.message);
    }
  };

  const adicionarItem = () => {
    setVistoriaAtual({
      ...vistoriaAtual,
      itens: [
        ...vistoriaAtual.itens,
        {
          id: Date.now(),
          comodo: '',
          descricao: '',
          estado: 'bom',
          fotoIds: [], // novo
          // fotos: [] // legado (não usamos em novos itens)
        }
      ]
    });
  };

  const removerItem = (itemId) => {
    if (confirm('Deseja remover este item?')) {
      setVistoriaAtual({
        ...vistoriaAtual,
        itens: vistoriaAtual.itens.filter(item => item.id !== itemId)
      });
    }
  };

  const atualizarItem = (itemId, campo, valor) => {
    setVistoriaAtual({
      ...vistoriaAtual,
      itens: vistoriaAtual.itens.map(item =>
        item.id === itemId ? { ...item, [campo]: valor } : item
      )
    });
  };

  // Fluxo NOVO: adicionar fotos (uma ou mais)
  const adicionarFotos = async (itemId, fileList) => {
    if (!fileList || fileList.length === 0) return;

    // Processa de forma sequencial (mais estável em mobile)
    for (const file of Array.from(fileList)) {
      if (!file.type || !file.type.startsWith('image/')) continue;

      try {
        // Tenta processar (EXIF + compressão <= 2,5MB)
        const blob = await processarImagem(file);
        const fotoId = await savePhotoBlob(itemId, blob);

        setVistoriaAtual(prev => ({
          ...prev,
          itens: prev.itens.map(it =>
            it.id === itemId
              ? { ...it, fotoIds: [...(it.fotoIds || []), fotoId] }
              : it
          )
        }));
      } catch (err) {
        // Falha na compressão ou processamento -> fallback: pular (silencioso)
        console.warn('Falha ao processar/comprimir imagem, será pulada.', err);
        // Não interrompe fluxo
      }
    }
  };

  // Botão "Câmera": um arquivo; Botão "Galeria/Pasta": múltiplos/dir
  const abrirCamera = (onFiles) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e) => onFiles(e.target.files);
    input.click();
  };

  const abrirGaleriaOuPasta = (onFiles) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    // Em browsers que suportam, permite escolher pasta
    try {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    } catch (_) {}
    input.onchange = (e) => {
      // Filtra apenas imagens
      const files = Array.from(e.target.files || []).filter(f => f.type && f.type.startsWith('image/'));
      onFiles(files);
    };
    input.click();
  };

  // Remoções
  const removerFotoBase64 = (itemId, fotoIndex) => {
    if (confirm('Deseja remover esta foto?')) {
      setVistoriaAtual({
        ...vistoriaAtual,
        itens: vistoriaAtual.itens.map(item =>
          item.id === itemId
            ? { ...item, fotos: (item.fotos || []).filter((_, i) => i !== fotoIndex) }
            : item
        )
      });
    }
  };

  const removerFotoId = async (itemId, fotoId) => {
    if (!fotoId) return;
    if (!confirm('Deseja remover esta foto?')) return;
    try {
      await deletePhotoBlob(fotoId);
      setVistoriaAtual(prev => ({
        ...prev,
        itens: prev.itens.map(it =>
          it.id === itemId
            ? { ...it, fotoIds: (it.fotoIds || []).filter(id => id !== fotoId) }
            : it
        )
      }));
    } catch (e) {
      console.error('Erro ao remover foto:', e);
      alert('Não foi possível remover a foto.');
    }
  };

  const excluirVistoria = (id) => {
    if (confirm('Deseja realmente excluir esta vistoria?')) {
      setVistorias(vistorias.filter(v => v.id !== id));
      // Observação: as fotos no IndexedDB ficarão órfãs se não forem removidas.
      // Poderíamos implementar uma limpeza automática por vistoria depois.
    }
  };

  // Geração de PDF (A4, retrato), com logo no canto superior direito
  const gerarRelatorioPDF = async (vistoria) => {
    setGerandoPDF(true);

    // Cria container invisível no DOM
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.width = '794px'; // ~A4 width em px / referência visual
    container.className = 'pdf-container rel-container';

    // Cabeçalho + logo
    const header = document.createElement('div');
    header.innerHTML = `
      <img src="${LOGO_PATH}" class="pdf-logo" alt="Logo" />
      <div class="rel-title">📋 Relatório de Vistoria</div>
      <div class="rel-info">
        <p><strong>📍 Endereço:</strong> ${escapeHtml(vistoria.endereco)}</p>
        <p><strong>📅 Data:</strong> ${new Date(vistoria.data).toLocaleDateString('pt-BR')}</p>
        <p><strong>🔐 Tipo:</strong> ${vistoria.tipo === 'entrada' ? 'Entrada' : 'Saída'}</p>
        ${vistoria.responsavel ? `<p><strong>👤 Responsável:</strong> ${escapeHtml(vistoria.responsavel)}</p>` : ''}
        <p><strong>📊 Total de itens:</strong> ${vistoria.itens.length}</p>
      </div>
      <div class="rel-h2">🏠 Itens Vistoriados</div>
    `;
    container.appendChild(header);

    // Monta itens (com fotos de duas fontes: Base64 legado e IndexedDB)
    for (let idx = 0; idx < vistoria.itens.length; idx++) {
      const item = vistoria.itens[idx];
      const itemDiv = document.createElement('div');
      itemDiv.className = 'rel-item';

      const titulo =
        `Item ${idx + 1}: ${item.comodo && item.comodo.trim() ? escapeHtml(item.comodo) : 'Sem identificação'}`;

      const descricaoHTML = item.descricao && item.descricao.trim()
        ? `<div class="mt-2"><strong>Descrição:</strong><div>${escapeHtml(item.descricao)}</div></div>`
        : '';

      itemDiv.innerHTML = `
        <div class="rel-h3">${titulo}</div>
        <div><strong>Estado:</strong> <span class="rel-estado ${item.estado}">${(item.estado || '').toUpperCase()}</span></div>
        ${descricaoHTML}
      `;

      // Bloco de fotos
      const fotosWrapper = document.createElement('div');
      const fotos = (item.fotos || []);     // legado (Base64)
      const fotoIds = (item.fotoIds || []); // atual (IndexedDB)
      const total = fotos.length + fotoIds.length;

      if (total > 0) {
        const fotosTitle = document.createElement('div');
        fotosTitle.innerHTML = `<div class="mt-2"><strong>Fotos (${total}):</strong></div>`;
        fotosWrapper.appendChild(fotosTitle);

        const grid = document.createElement('div');
        grid.className = 'rel-fotos';
        fotosWrapper.appendChild(grid);

        // 1) Base64 (legado)
        fotos.forEach((dataUrl, i) => {
          const box = document.createElement('div');
          box.className = 'rel-foto-box';
          box.innerHTML = `
            <img src="${dataUrl}" class="rel-foto" alt="Foto ${i + 1}" />
            <div class="rel-legenda">Foto (legado) ${i + 1}</div>
          `;
          grid.appendChild(box);
        });

        // 2) IndexedDB (ids -> blobs -> object URLs)
        const tempUrls = [];
        for (let j = 0; j < fotoIds.length; j++) {
          const id = fotoIds[j];
          const blob = await getPhotoBlob(id);
          if (blob) {
            const url = URL.createObjectURL(blob);
            tempUrls.push(url);
            const box = document.createElement('div');
            box.className = 'rel-foto-box';
            box.innerHTML = `
              <img src="${url}" class="rel-foto" alt="Foto ${fotos.length + j + 1}" />
              <div class="rel-legenda">Foto ${fotos.length + j + 1}</div>
            `;
            grid.appendChild(box);
          }
        }

        // Guardar para revogar após gerar PDF
        itemDiv._tempUrls = tempUrls;
        itemDiv.appendChild(fotosWrapper);
      } else {
        const vazio = document.createElement('div');
        vazio.style.cssText = 'color:#9ca3af;margin-top:10px;';
        vazio.textContent = 'Sem fotos anexadas';
        itemDiv.appendChild(vazio);
      }

      container.appendChild(itemDiv);
    }

    // Rodapé
    const footer = document.createElement('div');
    footer.className = 'rel-footer';
    footer.innerHTML =
      `<p>Relatório gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</p>`;
    container.appendChild(footer);

    // Anexa no body (fora da tela)
    document.body.appendChild(container);

    // Opções do PDF
    const filename = `vistoria-${normalizeFileName(vistoria.endereco)}-${vistoria.data}.pdf`;
    const opt = {
      margin:       10, // mm
      filename,
      image:        { type: 'jpeg', quality: 0.95 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
      await html2pdf().from(container).set(opt).save();
      alert('Relatório em PDF baixado! Verifique seus downloads.');
    } catch (e) {
      console.error('Erro ao gerar PDF:', e);
      alert('Erro ao gerar PDF. Tente novamente.');
    } finally {
      // Limpeza: revoga object URLs temporárias e remove o container
      try {
        container.querySelectorAll('.rel-item').forEach(div => {
          const tempUrls = div._tempUrls || [];
          tempUrls.forEach(u => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); });
        });
      } catch (_) {}
      if (container.parentNode) container.parentNode.removeChild(container);
      setGerandoPDF(false);
    }
  };

  // -----------------------------
  // TELAS
  // -----------------------------
  if (tela === 'lista') {
    return (
      <div className="min-h-screen bg-gray-50 p-4 pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-blue-600 text-3xl">🏠</span>
                <h1 className="text-2xl font-bold text-gray-800">Vistorias</h1>
              </div>
              <button
                onClick={novaVistoria}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 active:bg-blue-800"
              >
                <span className="text-lg">＋</span>
                Nova
              </button>
            </div>
            <p className="text-sm text-gray-600">
              {vistorias.length} {vistorias.length === 1 ? 'vistoria' : 'vistorias'} salva{vistorias.length !== 1 ? 's' : ''}
            </p>
          </div>

          {vistorias.length === 0 ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center">
              <div className="mx-auto text-gray-300 mb-4 text-6xl">🏠</div>
              <p className="text-gray-500 text-lg">Nenhuma vistoria cadastrada</p>
              <p className="text-gray-400 mt-2">Clique em "Nova" para começar</p>
            </div>
          ) : (
            <div className="space-y-3">
              {vistorias.map(v => (
                <div key={v.id} className="bg-white rounded-lg shadow-md p-4">
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-lg text-gray-800 truncate">{v.endereco}</h3>
                      <p className="text-gray-600 text-sm mt-1">
                        {new Date(v.data).toLocaleDateString('pt-BR')} • {v.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                      </p>
                      <p className="text-gray-500 text-sm mt-1">
                        {v.itens.length} {v.itens.length === 1 ? 'item' : 'itens'}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => gerarRelatorioPDF(v)}
                        className="text-green-600 hover:bg-green-50 active:bg-green-100 p-2 rounded"
                        title="Baixar relatório (PDF)"
                      >
                        ⬇️
                      </button>
                      <button
                        onClick={() => { setVistoriaAtual({ ...v }); setTela('nova'); }}
                        className="text-blue-600 hover:bg-blue-50 active:bg-blue-100 p-2 rounded"
                        title="Editar"
                      >
                        ➔
                      </button>
                      <button
                        onClick={() => excluirVistoria(v.id)}
                        className="text-red-600 hover:bg-red-50 active:bg-red-100 p-2 rounded"
                        title="Excluir"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {gerandoPDF && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-4 shadow-md text-gray-700">
              ⏳ Gerando PDF...
            </div>
          </div>
        )}
      </div>
    );
  }

  // Tela: Nova/Editar Vistoria
  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-32">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => {
                if (confirm('Deseja sair? As alterações serão salvas como rascunho.')) {
                  setTela('lista');
                }
              }}
              className="text-gray-600 hover:bg-gray-100 active:bg-gray-200 p-2 rounded"
            >
              ←
            </button>
            <h1 className="text-xl font-bold text-gray-800 flex-1 truncate">
              {vistoriaAtual.endereco || 'Nova Vistoria'}
            </h1>
            <span className={salvando ? 'text-green-600 animate-pulse' : 'text-gray-400'} title="Salvar">
              💾
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Endereço do Imóvel *</label>
              <input
                type="text"
                value={vistoriaAtual.endereco}
                onChange={(e) => setVistoriaAtual({ ...vistoriaAtual, endereco: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Rua, número, complemento"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data</label>
                <input
                  type="date"
                  value={vistoriaAtual.data}
                  onChange={(e) => setVistoriaAtual({ ...vistoriaAtual, data: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  value={vistoriaAtual.tipo}
                  onChange={(e) => setVistoriaAtual({ ...vistoriaAtual, tipo: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Responsável</label>
              <input
                type="text"
                value={vistoriaAtual.responsavel}
                onChange={(e) => setVistoriaAtual({ ...vistoriaAtual, responsavel: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Nome do responsável"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-800">Itens</h2>
            <button
              onClick={adicionarItem}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 active:bg-blue-800"
            >
              <span className="text-lg">＋</span>
              Item
            </button>
          </div>

          {vistoriaAtual.itens.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Nenhum item adicionado</p>
          ) : (
            <div className="space-y-4">
              {vistoriaAtual.itens.map((item, index) => (
                <div key={item.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-gray-800">Item {index + 1}</h3>
                    <button
                      onClick={() => removerItem(item.id)}
                      className="text-red-600 hover:bg-red-50 active:bg-red-100 p-1 rounded"
                      title="Remover item"
                    >
                      🗑️
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Cômodo</label>
                      <input
                        type="text"
                        value={item.comodo || ''}
                        onChange={(e) => atualizarItem(item.id, 'comodo', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Ex: Sala, Quarto 1, Cozinha"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                      <textarea
                        value={item.descricao || ''}
                        onChange={(e) => atualizarItem(item.id, 'descricao', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Descreva o estado ou observações"
                        rows={2}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                      <select
                        value={item.estado || 'bom'}
                        onChange={(e) => atualizarItem(item.id, 'estado', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="bom">Bom</option>
                        <option value="regular">Regular</option>
                        <option value="ruim">Ruim</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Fotos
                        {' '}
                        <span className="text-gray-400">
                          (total: {(item.fotoIds?.length || 0) + (item.fotos?.length || 0)})
                        </span>
                      </label>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => abrirCamera((files) => adicionarFotos(item.id, files))}
                          className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-200 active:bg-gray-300 w-full justify-center"
                        >
                          📷 Câmera
                        </button>
                        <button
                          onClick={() => abrirGaleriaOuPasta((files) => adicionarFotos(item.id, files))}
                          className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-200 active:bg-gray-300 w-full justify-center"
                        >
                          🖼️ Galeria/Pasta
                        </button>
                      </div>

                      <FotoGrid
                        item={item}
                        onRemoveBase64={(idx) => removerFotoBase64(item.id, idx)}
                        onRemoveId={(fotoId) => removerFotoId(item.id, fotoId)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
          <div className="max-w-4xl mx-auto flex gap-3">
            <button
              onClick={() => {
                if (confirm('Deseja sair? As alterações serão salvas como rascunho.')) {
                  setTela('lista');
                }
              }}
              className="flex-1 bg-gray-200 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-300 active:bg-gray-400 font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={salvarVistoria}
              disabled={salvando}
              className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 active:bg-blue-800 font-medium disabled:bg-blue-400 flex items-center justify-center gap-2"
            >
              {salvando ? (
                <>
                  <span>⏳</span>
                  Salvando...
                </>
              ) : (
                <>
                  <span>💾</span>
                  Salvar
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {gerandoPDF && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 shadow-md text-gray-700">
            ⏳ Gerando PDF...
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   5) HELPER FUNCTIONS
   ========================= */
// Escapa HTML simples para evitar problemas em texto livre
function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeFileName(s = '') {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase();
}
