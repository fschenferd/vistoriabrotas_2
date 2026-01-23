
// App de Vistoria — versão sem build (React via CDN)
// Fluxo simples e compatível com iPhone/Safari:
// - Fotos em Base64 (localStorage) com compressão <= 2,5MB (senão, pula)
// - EXIF (exifr) para corrigir orientação
// - PDF (html2pdf) A4 retrato, logo no topo direito

const { useState, useEffect } = React;

/* =========================
   0) CONFIGURAÇÕES
   ========================= */
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024; // 2,5 MB
const MAX_SIDE_PX = 1920;                  // lado maior
const JPEG_START_QUALITY = 0.85;
const JPEG_MIN_QUALITY = 0.60;
const PROCESS_TIMEOUT_MS = 8000;           // 8s
const LOGO_PATH = './assets/IB.png';       // seu logo
const AUTO_PDF_ON_SAVE = true;             // baixa PDF automaticamente ao salvar

/* =========================
   1) UTILITÁRIOS DE IMAGEM
   ========================= */
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

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Falha ao exportar imagem.')),
      'image/jpeg',
      quality
    );
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Falha ao converter blob.'));
    fr.onload = () => resolve(fr.result); // dataURL
    fr.readAsDataURL(blob);
  });
}

function applyExifTransform(ctx, orientation, width, height) {
  switch (orientation) {
    case 2: ctx.translate(width, 0); ctx.scale(-1, 1); break;             // flip H
    case 3: ctx.translate(width, height); ctx.rotate(Math.PI); break;      // 180°
    case 4: ctx.translate(0, height); ctx.scale(1, -1); break;             // flip V
    case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;            // transpose
    case 6: ctx.rotate(0.5 * Math.PI); ctx.translate(0, -height); break;   // 90° CW
    case 7: ctx.rotate(0.5 * Math.PI); ctx.translate(width, -height); ctx.scale(-1, 1); break;
    case 8: ctx.rotate(-0.5 * Math.PI); ctx.translate(-width, 0); break;   // 270° CCW
    case 1:
    default: break;
  }
}

/**
 * Processa imagem:
 * - Lê EXIF (orientation)
 * - Redimensiona (lado <= MAX_SIDE_PX)
 * - Comprime para JPEG até <= 2,5MB (ou dá erro -> vamos pular a foto)
 * - Retorna dataURL (Base64)
 */
async function processarImagemComoDataURL(file, {
  maxBytes = MAX_IMAGE_BYTES,
  maxSide = MAX_SIDE_PX,
  startQuality = JPEG_START_QUALITY,
  minQuality = JPEG_MIN_QUALITY,
  timeoutMs = PROCESS_TIMEOUT_MS
} = {}) {

  const withTimeout = (p) => Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);

  return await withTimeout((async () => {
    const orientation = await exifr.orientation(file).catch(() => 1) || 1;
    const img = await fileToImage(file);

    let sw = img.naturalWidth || img.width;
    let sh = img.naturalHeight || img.height;

    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    let tw = Math.round(sw * scale);
    let th = Math.round(sh * scale);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    async function redrawAndExport(quality) {
      const rotate90 = (orientation >= 5 && orientation <= 8);
      canvas.width = rotate90 ? th : tw;
      canvas.height = rotate90 ? tw : th;
      ctx.save();
      applyExifTransform(ctx, orientation, canvas.width, canvas.height);

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

    while (blob.size > maxBytes && quality > minQuality) {
      quality = Math.max(minQuality, +(quality - 0.05).toFixed(2));
      blob = await redrawAndExport(quality);
    }

    while (blob.size > maxBytes && (tw > 1280 || th > 1280)) {
      tw = Math.round(tw * 0.9);
      th = Math.round(th * 0.9);
      blob = await redrawAndExport(quality);
      if (quality > minQuality && blob.size > maxBytes) {
        quality = Math.max(minQuality, +(quality - 0.05).toFixed(2));
        blob = await redrawAndExport(quality);
      }
    }

    if (blob.size > maxBytes) throw new Error('imagem_maior_que_limite');

    // Converte para Base64 (compatível com Safari e html2pdf/html2canvas)
    const dataURL = await blobToDataURL(blob);
    return dataURL;
  })());
}

/* =========================
   2) APP
   ========================= */
function VistoriaApp() {
  const [vistorias, setVistorias] = useState([]);
  const [vistoriaAtual, setVistoriaAtual] = useState(null);
  const [tela, setTela] = useState('lista');
  const [salvando, setSalvando] = useState(false);
  const [gerandoPDF, setGerandoPDF] = useState(false);

  // Carrega vistorias
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vistorias_imoveis');
      if (saved) setVistorias(JSON.parse(saved) || []);
    } catch (e) {
      console.error('Erro ao carregar vistorias:', e);
    }
  }, []);

  // Persiste vistorias
  useEffect(() => {
    try {
      localStorage.setItem('vistorias_imoveis', JSON.stringify(vistorias));
    } catch (e) {
      console.error('Erro ao salvar vistorias:', e);
      alert('Erro ao salvar dados. Libere espaço no dispositivo.');
    }
  }, [vistorias]);

  // Rascunho
  useEffect(() => {
    if (vistoriaAtual && tela === 'nova') {
      try {
        localStorage.setItem('vistoria_rascunho', JSON.stringify(vistoriaAtual));
      } catch (e) {}
    }
  }, [vistoriaAtual, tela]);

  // Ações principais
  const novaVistoria = () => {
    try {
      const draft = localStorage.getItem('vistoria_rascunho');
      if (draft && confirm('Existe um rascunho salvo. Deseja recuperá-lo?')) {
        setVistoriaAtual(JSON.parse(draft));
        setTela('nova');
        return;
      }
    } catch {}
    setVistoriaAtual({
      id: Date.now(),
      data: new Date().toISOString().split('T')[0],
      endereco: '',
      tipo: 'entrada',
      responsavel: '',
      itens: [] // { id, comodo, descricao, estado, fotos: [dataURL] }
    });
    setTela('nova');
  };

  const salvarVistoria = async () => {
    if (!vistoriaAtual.endereco.trim()) {
      alert('Por favor, preencha o endereço do imóvel');
      return;
    }
    setSalvando(true);
    try {
      const novas = [...vistorias];
      const i = novas.findIndex(v => v.id === vistoriaAtual.id);
      if (i >= 0) novas[i] = { ...vistoriaAtual };
      else novas.push({ ...vistoriaAtual });

      setVistorias(novas);
      localStorage.removeItem('vistoria_rascunho');

      await new Promise(r => setTimeout(r, 150)); // estabilidade

      setSalvando(false);
      alert('Vistoria salva com sucesso!');

      if (AUTO_PDF_ON_SAVE) {
        const vFinal = novas.find(v => v.id === vistoriaAtual.id);
        if (vFinal) await gerarRelatorioPDF(vFinal);
      }

      setTela('lista');
      setVistoriaAtual(null);
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
        { id: Date.now(), comodo: '', descricao: '', estado: 'bom', fotos: [] }
      ]
    });
  };

  const removerItem = (itemId) => {
    if (!confirm('Deseja remover este item?')) return;
    setVistoriaAtual({
      ...vistoriaAtual,
      itens: vistoriaAtual.itens.filter(i => i.id !== itemId)
    });
  };

  const atualizarItem = (itemId, campo, valor) => {
    setVistoriaAtual({
      ...vistoriaAtual,
      itens: vistoriaAtual.itens.map(i => i.id === itemId ? { ...i, [campo]: valor } : i)
    });
  };

  // Fotos
  const adicionarFotos = async (itemId, files) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const mime = (file.type || '').toLowerCase();
      if (!mime.startsWith('image/')) continue;
      try {
        const dataURL = await processarImagemComoDataURL(file); // <= 2,5MB
        setVistoriaAtual(prev => ({
          ...prev,
          itens: prev.itens.map(it =>
            it.id === itemId ? { ...it, fotos: [...(it.fotos || []), dataURL] } : it
          )
        }));
      } catch (err) {
        console.warn('Não foi possível processar esta imagem. Ela será ignorada.', err);
        // Fallback desejado: pular
      }
    }
  };

  const abrirCamera = (onFiles) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment'; // câmera traseira
    input.multiple = false;        // iOS gosta disso para a câmera
    input.onchange = (e) => {
      const fl = e.target.files;
      if (!fl || fl.length === 0) return;
      onFiles(fl);
    };
    input.click();
  };

  const abrirGaleria = (onFiles) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;         // várias imagens
    // Importante: NÃO usar webkitdirectory ou directory (isso abre seletor de pastas)
    input.onchange = (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      onFiles(files);
    };
    input.click();
  };

  const removerFoto = (itemId, idxFoto) => {
    if (!confirm('Deseja remover esta foto?')) return;
    setVistoriaAtual({
      ...vistoriaAtual,
      itens: vistoriaAtual.itens.map(it =>
        it.id === itemId
          ? { ...it, fotos: (it.fotos || []).filter((_, i) => i !== idxFoto) }
          : it
      )
    });
  };

  const excluirVistoria = (id) => {
    if (!confirm('Deseja realmente excluir esta vistoria?')) return;
    setVistorias(vistorias.filter(v => v.id !== id));
  };

  // PDF
  const gerarRelatorioPDF = async (vistoria) => {
    setGerandoPDF(true);

    // Container invisível com estilos básicos
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-10000px';
    container.style.top = '0';
    container.style.width = '794px';
    container.style.background = '#fff';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.padding = '20px';

    container.innerHTML = `
      <div style="position:relative; min-height: 80px;">
        <img src="${LOGO_PATH}" alt="Logo" style="position:absolute; top:0; right:0; width:120px; height:auto;" />
        <h1 style="color:#2563eb; margin:0 0 8px; font-size:24px;">📋 Relatório de Vistoria</h1>
      </div>

      <div style="margin:16px 0; padding:12px; background:#f3f4f6; border-left:4px solid #2563eb; border-radius:8px;">
        <p style="margin:6px 0;"><strong>📍 Endereço:</strong> ${escapeHtml(vistoria.endereco)}</p>
        <p style="margin:6px 0;"><strong>📅 Data:</strong> ${new Date(vistoria.data).toLocaleDateString('pt-BR')}</p>
        <p style="margin:6px 0;"><strong>🔐 Tipo:</strong> ${vistoria.tipo === 'entrada' ? 'Entrada' : 'Saída'}</p>
        ${vistoria.responsavel ? `<p style="margin:6px 0;"><strong>👤 Responsável:</strong> ${escapeHtml(vistoria.responsavel)}</p>` : ''}
        <p style="margin:6px 0;"><strong>📊 Total de itens:</strong> ${vistoria.itens.length}</p>
      </div>

      <h2 style="margin:20px 0 10px; font-size:20px;">🏠 Itens Vistoriados</h2>
    `;

    // Itens + fotos
    vistoria.itens.forEach((item, idx) => {
      const itemDiv = document.createElement('div');
      itemDiv.style.cssText = 'margin:16px 0; padding:12px; border:2px solid #e5e7eb; border-radius:8px; page-break-inside:avoid;';

      const titulo = `Item ${idx + 1}: ${item.comodo && item.comodo.trim() ? escapeHtml(item.comodo) : 'Sem identificação'}`;

      let html = `
        <h3 style="margin:0 0 8px; font-size:18px;">${titulo}</h3>
        <div><strong>Estado:</strong> <span style="display:inline-block;padding:4px 10px;border-radius:12px;font-weight:bold;background:${item.estado==='bom'?'#dcfce7':item.estado==='regular'?'#fef9c3':'#fee2e2'};color:${item.estado==='bom'?'#166534':item.estado==='regular'?'#854d0e':'#991b1b'};">${(item.estado||'').toUpperCase()}</span></div>
      `;
      if (item.descricao && item.descricao.trim()) {
        html += `<div style="margin-top:8px;"><strong>Descrição:</strong><div>${escapeHtml(item.descricao)}</div></div>`;
      }

      // Fotos
      const fotos = item.fotos || [];
      if (fotos.length > 0) {
        html += `<div style="margin-top:8px;"><strong>Fotos (${fotos.length}):</strong></div>`;
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:8px;';

        fotos.forEach((dataUrl, i) => {
          const box = document.createElement('div');
          box.style.cssText = 'border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#f9fafb;';
          box.innerHTML = `
            <img src="${dataUrl}" alt="Foto ${i + 1}" style="width:100%;height:auto;display:block;" />
            <div style="padding:6px;font-size:12px;color:#6b7280;text-align:center;">Foto ${i + 1}</div>
          `;
          grid.appendChild(box);
        });

        itemDiv.innerHTML = html;
        itemDiv.appendChild(grid);
      } else {
        html += `<div style="color:#9ca3af;margin-top:8px;">Sem fotos anexadas</div>`;
        itemDiv.innerHTML = html;
      }

      container.appendChild(itemDiv);
    });

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:24px;padding-top:12px;border-top:2px solid #e5e7eb;color:#6b7280;font-size:12px;text-align:center;';
    footer.innerHTML = `<p>Relatório gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</p>`;
    container.appendChild(footer);

    document.body.appendChild(container);

    const filename = `vistoria-${normalizeFileName(vistoria.endereco)}-${vistoria.data}.pdf`;
    const opt = {
      margin:       10,
      filename,
      image:        { type: 'jpeg', quality: 0.95 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
      await html2pdf().from(container).set(opt).save();
    } catch (e) {
      console.error('Erro ao gerar PDF:', e);
      alert('Erro ao gerar PDF. Tente novamente.');
    } finally {
      if (container.parentNode) container.parentNode.removeChild(container);
      setGerandoPDF(false);
    }
  };

  // Telas
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

  // Tela de edição
  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-32">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => {
                if (confirm('Deseja sair? As alterações serão salvas como rascunho.')) setTela('lista');
              }}
              className="text-gray-600 hover:bg-gray-100 active:bg-gray-200 p-2 rounded"
            >
              ←
            </button>
            <h1 className="text-xl font-bold text-gray-800 flex-1 truncate">
              {vistoriaAtual.endereco || 'Nova Vistoria'}
            </h1>
            <span className={salvando ? 'text-green-600 animate-pulse' : 'text-gray-400'} title="Salvar">💾</span>
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
                        Fotos <span className="text-gray-400">(total: {item.fotos?.length || 0})</span>
                      </label>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => abrirCamera((files) => adicionarFotos(item.id, files))}
                          className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg w-full"
                        >
                          📷 Câmera
                        </button>

                        <button
                          onClick={() => abrirGaleria((files) => adicionarFotos(item.id, files))}
                          className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg w-full"
                        >
                          🖼️ Galeria
                        </button>
                      </div>

                      {/* mini-grid com as fotos */}
                      {item.fotos?.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          {item.fotos.map((foto, i) => (
                            <div key={i} className="relative">
                              <img src={foto} alt={`Foto ${i + 1}`} className="w-full h-32 object-cover rounded-lg" />
                              <button
                                onClick={() => removerFoto(item.id, i)}
                                className="absolute top-1 right-1 bg-red-600 text-white px-2 py-1 rounded-full hover:bg-red-700"
                                title="Remover foto"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
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
                if (confirm('Deseja sair? As alterações serão salvas como rascunho.')) setTela('lista');
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
              {salvando ? (<><span>⏳</span> Salvando...</>) : (<><span>💾</span> Salvar</>)}
            </button>
          </div>
        </div>

        {gerandoPDF && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-4 shadow-md text-gray-700">⏳ Gerando PDF...</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================
   3) HELPERS
   ========================= */
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeFileName(s = '') {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase();
}
