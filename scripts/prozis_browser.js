// Recolha Prozis no browser — DB Alimentar NUTS
// Colar na Consola do Chrome/Edge com uma página da prozis.com aberta.
// No fim descarrega "prozis_dados.json.gz" (e cópias de segurança a cada 100 produtos). Envia o último ao Claude.
// Para descarregar a meio: escrever  baixar()  na consola.
(async () => {
  const CATEGORIAS = [
    "/pt/pt/nutricao-desportiva/proteina",
    "/pt/pt/nutricao-desportiva/queimadores-de-gordura-e-definicao-muscular",
    "/pt/pt/nutricao-desportiva/desenvolvimento-muscular",
    "/pt/pt/nutricao-desportiva/pre-intra-e-pos-treino",
    "/pt/pt/nutricao-desportiva/saude-do-atleta",
    "/pt/pt/nutricao-desportiva/energia-e-resistencia",
    "/pt/pt/nutricao-desportiva/com-certificado-doping-free",
    "/pt/pt/saude-e-emagrecimento/colagenio",
    "/pt/pt/saude-e-emagrecimento/perda-de-peso",
    "/pt/pt/saude-e-emagrecimento/saude",
    "/pt/pt/saude-e-emagrecimento/vitaminas-minerais-e-ervas",
  ];
  const ESPERA = 1200;
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const estado = { produtos: {}, paginas: [], erros: [] };
  window.__prozis = estado;

  async function obter(url) {
    let espera = 60000;
    for (let t = 0; t < 8; t++) {
      try {
        const r = await fetch(url, { credentials: "include" });
        const txt = await r.text();
        if (r.status === 200 && !/challenges\.cloudflare\.com\/cdn-cgi|cf-chl-|Just a moment/i.test(txt.slice(0, 5000))) return txt;
        if (r.status === 404) return null;
        console.warn(`⚠️ ${r.status} em ${url} — a esperar ${espera / 1000}s`);
      } catch (e) { console.warn("⚠️ falha de ligação", e); }
      await dormir(espera);
      espera = Math.min(espera * 2, 600000);
    }
    estado.erros.push(url);
    return null;
  }

  function dadosCatalogo(html) {
    const marca = "VueEs6.render('#catalog-desktop','ComponentLoader',";
    let i = html.indexOf(marca);
    if (i < 0) return null;
    i += marca.length;
    let nivel = 0, emTexto = false, esc = false;
    for (let j = i; j < html.length; j++) {
      const c = html[j];
      if (emTexto) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') emTexto = false; }
      else if (c === '"') emTexto = true;
      else if (c === "{") nivel++;
      else if (c === "}") { nivel--; if (nivel === 0) { try { return JSON.parse(html.slice(i, j + 1)).props.compProps.catalogData.wsData; } catch (e) { return null; } } }
    }
    return null;
  }

  async function gz(texto) {
    const stream = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).blob();
  }

  window.baixar = async () => {
    const blob = await gz(JSON.stringify(estado));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prozis_dados.json.gz";
    document.body.appendChild(a);
    a.click();
    console.log(`✅ Descarregado prozis_dados.json.gz (${(blob.size / 1e6).toFixed(1)} MB)`);
  };

  // 1) listas das categorias
  for (const cat of CATEGORIAS) {
    let total = 1;
    for (let n = 1; n <= total && n <= 60; n++) {
      const url = `${cat}?ls=popularity&pp=100&page=${n}`;
      const html = await obter(url);
      await dormir(ESPERA);
      if (!html) break;
      const ws = dadosCatalogo(html);
      if (!ws) { console.warn("Sem dados de catálogo em", url); estado.paginas.push({ url, semDados: true }); break; }
      total = (ws.pagination && ws.pagination.totalPages) || 1;
      let novos = 0;
      for (const r of ws.results || []) {
        const p = r.product || {};
        if (p.url && !estado.produtos[p.url]) {
          estado.produtos[p.url] = { url: "https://www.prozis.com" + p.url, nome: p.name, categoria: cat, preco: p.price };
          novos++;
        }
      }
      console.log(`📂 ${cat} — página ${n}/${total}: ${novos} novos (total ${Object.keys(estado.produtos).length})`);
    }
  }

  // 2) cada produto, aberto num iframe invisível, com a "Declaração Nutricional" aberta
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;left:-3000px;top:0;width:1400px;height:3000px;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  function carregar(url) {
    return new Promise((resolve) => {
      let feito = false;
      const fim = () => { if (!feito) { feito = true; resolve(); } };
      frame.onload = fim;
      setTimeout(fim, 30000);
      frame.src = url;
    });
  }

  async function recolherProduto(p) {
    await carregar(p.url);
    const d = frame.contentDocument;
    if (!d || !d.body) return null;
    if (/Just a moment|cf-chl|challenges\.cloudflare/i.test(d.documentElement.innerHTML.slice(0, 20000))) return "bloqueado";
    for (let k = 0; k < 20; k++) {
      if (/Declara[çc][ãa]o Nutricional|Informa[çc][ãa]o Nutricional|Ingredientes/i.test(d.body.innerText)) break;
      await dormir(500);
    }
    const RX = /^(Declara[çc][ãa]o Nutricional|Informa[çc][ãa]o Nutricional|Tabela Nutricional|Ingredientes|Modo de Utiliza[çc][ãa]o|Al[ée]rg[ée]nios|Composi[çc][ãa]o)$/i;
    const alvos = [...d.querySelectorAll("button,a,div,span,li,h2,h3,h4,p")]
      .filter((n) => RX.test((n.innerText || "").trim()))
      .filter((n) => ![...n.children].some((c) => RX.test((c.innerText || "").trim())));
    for (const n of alvos.slice(0, 6)) {
      try { n.scrollIntoView(); n.click(); } catch (e) {}
      for (let k = 0; k < 16; k++) {
        if (d.querySelector("table") || /\bkcal\b|Valor energ[ée]tico|Doses por embalagem/i.test(d.body.innerText)) break;
        await dormir(500);
      }
      await dormir(400);
    }
    await dormir(600);
    const tabelas = [...d.querySelectorAll("table")].map((t) => t.outerHTML).filter((t) => /kcal|Energia|Dose/i.test(t));
    const texto = d.body.innerText;
    const ld = [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);
    return { titulo: d.title, ld, tabelas, texto: texto.slice(0, 60000), botoes: alvos.map((n) => n.innerText.trim()) };
  }

  const lista = Object.values(estado.produtos);
  console.log(`\n🔎 ${lista.length} produtos. A recolher cada um (pode demorar 1-3 horas; deixa este separador aberto)...`);
  let i = 0;
  for (const p of lista) {
    i++;
    let r = null;
    for (let t = 0; t < 4; t++) {
      r = await recolherProduto(p);
      if (r && r !== "bloqueado") break;
      console.warn(`⚠️ página não carregou (${p.nome}) — a esperar 60s`);
      await dormir(60000);
    }
    if (r && r !== "bloqueado") p.pagina = r; else estado.erros.push(p.url);
    const ok = r && r !== "bloqueado" && /kcal|Doses por embalagem|Ingredientes/i.test(r.texto);
    console.log(`[${i}/${lista.length}] ${p.pagina ? "ok" : "falhou"}${ok ? " (declaração ✔)" : ""} — ${p.nome}`);
    document.title = `Prozis ${i}/${lista.length}`;
    if (i % 100 === 0) await window.baixar();
    await dormir(ESPERA);
  }

  console.log(`\n🏁 Terminado. ${estado.erros.length} falharam. A descarregar o ficheiro final...`);
  await window.baixar();
})();
