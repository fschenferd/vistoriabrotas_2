
# Imobiliária Brotas Vistoria (Web App)
Aplicativo simples de **vistoria de imóveis** que roda 100% no **navegador** (compatível com **GitHub Pages**).  
Funciona **offline**, guarda vistorias localmente e gera **relatório em PDF (A4, retrato)** com fotos e logo da imobiliária.

## ✨ Funcionalidades
- Cadastro de vistorias (entrada/saída), com endereço, responsável e itens.
- Inclusão de fotos por **Câmera** ou **Galeria/Pasta** (seleção múltipla).
- **Correção de orientação EXIF** (fotos não ficam de lado).
- **Compressão automática** de cada foto até **≤ 2,5 MB** (se falhar, a foto é **pulada** sem travar o app).
- Armazenamento de fotos como **Blob** em **IndexedDB** (rápido e estável para muitas fotos).
- Geração de **PDF** com **logo no canto superior direito**.
- Tudo client-side, sem servidor.

## 🗂 Estrutura do projeto
``
