const { useState, useEffect } = React;

function VistoriaApp() {
  const [vistorias, setVistorias] = useState([]);
  const [vistoriaAtual, setVistoriaAtual] = useState(null);
  const [tela, setTela] = useState('lista');
  const [salvando, setSalvando] = useState(false);

  // Carregar vistorias ao iniciar
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

  // Auto-salvar vistoria atual a cada mudança
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
    // Verificar se existe rascunho
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
      itens: []
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
      const index = novasVistorias.findIndex(v => v.id === vistoriaAtual.id);

      if (index >= 0) {
        novasVistorias[index] = { ...vistoriaAtual };
      } else {
        novasVistorias.push({ ...vistoriaAtual });
      }

      setVistorias(novasVistorias);

      // Limpar rascunho
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
      itens: [...vistoriaAtual.itens, {
        id: Date.now(),
        comodo: '',
        descricao: '',
        estado: 'bom',
        fotos: []
      }]
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

  const adicionarFoto = (itemId, arquivo) => {
    if (!arquivo) return;

    // Limite: 2 MB = 2 * 1024 * 1024 bytes
    const MAX_SIZE = 2 * 1024 * 1024;

    if (arquivo.size <= MAX_SIZE) {
      // Menor ou igual a 2 MB: processar normalmente
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          setVistoriaAtual({
            ...vistoriaAtual,
            itens: vistoriaAtual.itens.map(item =>
              item.id === itemId
                ? { ...item, fotos: [...item.fotos, e.target.result] }
                : item
            )
          });
        } catch (err) {
          alert('Erro ao adicionar foto. Tente uma foto menor.');
        }
      };
      reader.onerror = () => alert('Erro ao ler arquivo da foto.');
      reader.readAsDataURL(arquivo);
      return;
    }

    // Maior que 2 MB: tentar redimensionar/comprimir
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Redimensionar para 1024px de largura (mantendo proporção)
        const MAX_WIDTH = 1024;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Tentar compressão com qualidade 0.8
        let dataURL = canvas.toDataURL('image/jpeg', 0.8);

        // Verificar se está dentro do limite
        const byteString = atob(dataURL.split(',')[1]);
        if (byteString.length <= MAX_SIZE) {
          // Sucesso: usar imagem comprimida
          setVistoriaAtual({
            ...vistoriaAtual,
            itens: vistoriaAtual.itens.map(item =>
              item.id === itemId
                ? { ...item, fotos: [...item.fotos, dataURL] }
                : item
            )
          });
          return;
        }

        // Falha na compressão: usar original (sem erro)
        const reader2 = new FileReader();
        reader2.onload = (e2) => {
          setVistoriaAtual({
            ...vistoriaAtual,
            itens: vistoriaAtual.itens.map(item =>
              item.id === itemId
                ? { ...item, fotos: [...item.fotos, e2.target.result] }
                : item
            )
          });
        };
        reader2.onerror = () => alert('Erro ao ler arquivo da foto original.');
        reader2.readAsDataURL(arquivo);
      };
    };

    reader.onerror = () => alert('Erro ao ler arquivo da foto.');
    reader.readAsDataURL(arquivo);
  };

  const removerFoto = (itemId, fotoIndex) => {
    if (confirm('Deseja remover esta foto?')) {
      setVistoriaAtual({
        ...vistoriaAtual,
        itens: vistoriaAtual.itens.map(item =>
          item.id === itemId
            ? { ...item, fotos: item.fotos.filter((_, i) => i !== fotoIndex) }
            : item
        )
      });
    }
  };

  const excluirVistoria = (id) => {
    if (confirm('Deseja realmente excluir esta vistoria?')) {
      setVistorias(vistorias.filter(v => v.id !== id));
    }
  };

  const gerarRelatorio = (vistoria) => {
    try {
      const conteudo = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vistoria - ${vistoria.endereco}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      max-width: 800px;
      margin: 0 auto;
      background: #f9fafb;
    }
    .container { background: white; padding: 20px; border-radius: 8px; }
    h1 { color: #2563eb; margin-bottom: 20px; font-size: 24px; }
    h2 { color: #374151; margin: 30px 0 15px; font-size: 20px; }
    h3 { color: #1f2937; margin: 15px 0 10px; font-size: 18px; }
    .info {
      margin: 20px 0;
      padding: 15px;
      background: #f3f4f6;
      border-radius: 8px;
      border-left: 4px solid #2563eb;
    }
    .info p { margin: 8px 0; line-height: 1.6; }
    .item {
      margin: 20px 0;
      padding: 15px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      page-break-inside: avoid;
    }
    .fotos {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .foto-container {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      background: #f9fafb;
    }
    .foto {
      width: 100%;
      height: auto;
      display: block;
    }
    .foto-legenda {
      padding: 8px;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
    .estado {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: bold;
      margin: 10px 0;
    }
    .bom { background: #dcfce7; color: #166534; }
    .regular { background: #fef9c3; color: #854d0e; }
    .ruim { background: #fee2e2; color: #991b1b; }
    .campo { margin: 10px 0; }
    .campo strong { color: #374151; }
    .campo-valor { color: #1f2937; margin-top: 4px; }
    @media print {
      body { background: white; }
      .container { padding: 0; }
    }
    @media (max-width: 600px) {
      body { padding: 10px; }
      .container { padding: 15px; }
      h1 { font-size: 20px; }
      h2 { font-size: 18px; }
      .fotos { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📋 Relatório de Vistoria</h1>
    
    <div class="info">
      <p><strong>📍 Endereço:</strong> ${vistoria.endereco}</p>
      <p><strong>📅 Data:</strong> ${new Date(vistoria.data).toLocaleDateString('pt-BR')}</p>
      <p><strong>🔑 Tipo:</strong> ${vistoria.tipo === 'entrada' ? 'Entrada' : 'Saída'}</p>
      ${vistoria.responsavel ? `<p><strong>👤 Responsável:</strong> ${vistoria.responsavel}</p>` : ''}
      <p><strong>📊 Total de itens:</strong> ${vistoria.itens.length}</p>
    </div>
    
    <h2>🏠 Itens Vistoriados</h2>
    
    ${vistoria.itens.length === 0 ? '<p style="color: #6b7280; padding: 20px; text-align: center;">Nenhum item vistoriado</p>' : ''}
    
    ${vistoria.itens.map((item, index) => `
      <div class="item">
        <h3>Item ${index + 1}: ${item.comodo || 'Sem identificação'}</h3>
        
        <div class="campo">
          <strong>Estado:</strong>
          <div><span class="estado ${item.estado}">${item.estado.toUpperCase()}</span></div>
        </div>
        
        ${item.descricao ? `
          <div class="campo">
            <strong>Descrição:</strong>
            <div class="campo-valor">${item.descricao}</div>
          </div>
        ` : ''}
        
        ${item.fotos.length > 0 ? `
          <div class="campo">
            <strong>Fotos (${item.fotos.length}):</strong>
            <div class="fotos">
              ${item.fotos.map((foto, fotoIndex) => `
                <div class="foto-container">
                  <img src="${foto}" class="foto" alt="Foto ${fotoIndex + 1}" />
                  <div class="foto-legenda">Foto ${fotoIndex + 1}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : '<p style="color: #9ca3af; margin-top: 10px;">Sem fotos anexadas</p>'}
      </div>
    `).join('')}
    
    <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #6b7280; font-size: 12px; text-align: center;">
      <p>Relatório gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</p>
    </div>
  </div>
</body>
</html>`;

      // Calcular tamanho em bytes
      const tamanhoBytes = new TextEncoder().encode(conteudo).length;
      const tamanhoMB = tamanhoBytes / (1024 * 1024);

      if (tamanhoMB > 50) {
        if (!confirm(`O relatório está com ${tamanhoMB.toFixed(1)} MB. Isso pode causar problemas ao abrir. Deseja continuar?`)) {
          return;
        }
      }

      const blob = new Blob([conteudo], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const nomeArquivo = `vistoria-${vistoria.endereco.replace(/[^a-zA-Z0-9]/g, '-')}-${vistoria.data}.html`;

      a.href = url;
      a.download = nomeArquivo;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      alert('Relatório baixado! Verifique seus downloads.');
    } catch (e) {
      console.error('Erro ao gerar relatório:', e);
      alert('Erro ao gerar relatório. Tente novamente.');
    }
  };

  // ---------- TELAS ----------
  // Tela: Lista de Vistorias
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
                      <p className="text-gray-500 text-sm mt-1">{v.itens.length} {v.itens.length === 1 ? 'item' : 'itens'}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => gerarRelatorio(v)}
                        className="text-green-600 hover:bg-green-50 active:bg-green-100 p-2 rounded"
                        title="Baixar relatório"
                      >
                        ⬇️
                      </button>
                      <button
                        onClick={() => { setVistoriaAtual({...v}); setTela('nova'); }}
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
                        value={item.comodo}
                        onChange={(e) => atualizarItem(item.id, 'comodo', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Ex: Sala, Quarto 1, Cozinha"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                      <textarea
                        value={item.descricao}
                        onChange={(e) => atualizarItem(item.id, 'descricao', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Descreva o estado ou observações"
                        rows={2}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                      <select
                        value={item.estado}
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
                        Fotos ({item.fotos.length})
                      </label>
                      <button
                        onClick={() => {
                          const escolha = confirm('Deseja tirar uma foto? (Câmera traseira)') ? 'camera' : 'galeria';
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = 'image/*';
                          if (escolha === 'camera') {
                            input.capture = 'environment';
                          }
                          input.onchange = (e) => {
                            if (e.target.files && e.target.files[0]) {
                              adicionarFoto(item.id, e.target.files[0]);
                            }
                          };
                          input.click();
                        }}
                        className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-200 active:bg-gray-300 w-full justify-center"
                      >
                        <span>📷</span>
                        Adicionar Foto
                      </button>

                      {item.fotos.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          {item.fotos.map((foto, fotoIndex) => (
                            <div key={fotoIndex} className="relative">
                              <img
                                src={foto}
                                className="w-full h-32 object-cover rounded-lg"
                                alt={`Foto ${fotoIndex + 1}`}
                                loading="lazy"
                              />
                              <button
                                onClick={() => removerFoto(item.id, fotoIndex)}
                                className="absolute top-1 right-1 bg-red-600 text-white px-2 py-1 rounded-full hover:bg-red-700 active:bg-red-800"
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
    </div>
  );
}
