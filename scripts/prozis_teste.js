// TESTE (3 produtos) — Recolha Prozis no browser — DB Alimentar NUTS
// Colar na Consola do Chrome/Edge com uma página da prozis.com aberta (ver instruções).
// No fim descarrega automaticamente "prozis_dados.json.gz". Envia esse ficheiro ao Claude.
// Se precisares de parar a meio, escreve  baixar()  na consola para descarregar o que já foi recolhido.
// (A cada 100 produtos descarrega também uma cópia de segurança.)
(async () => {
  const CATEGORIAS = [
    "/pt/pt/nutricao-desportiva/proteina",
  ];
  const _resto = [
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
  const ESPERA = 1500;
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
        console.warn(`⚠️ ${r.status} em ${url} — a esperar ${espera / 1000}s (o site pediu para abrandar)`);
      } catch (e) {
        console.warn("⚠️ falha de ligação, a tentar outra vez", e);
      }
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
    // extrair o objeto JSON equilibrando chavetas
    let nivel = 0, emTexto = false, esc = false;
    for (let j = i; j < html.length; j++) {
      const c = html[j];
      if (emTexto) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') emTexto = false;
      } else if (c === '"') emTexto = true;
      else if (c === "{") nivel++;
      else if (c === "}") {
        nivel--;
        if (nivel === 0) {
          try { return JSON.parse(html.slice(i, j + 1)).props.compProps.catalogData.wsData; } catch (e) { return null; }
        }
      }
    }
    return null;
  }

  function reduzir(html) {
    // guarda apenas o que interessa: dados estruturados, blocos de dados da página e o texto principal
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);
    const vue = [...doc.querySelectorAll("script")].map((s) => s.textContent).filter((t) => /VueEs6\.render|__INITIAL|window\.__|productData|nutri/i.test(t));
    doc.querySelectorAll("script,style,svg,noscript,link,iframe").forEach((n) => n.remove());
    const corpo = doc.body ? doc.body.innerHTML : "";
    return { titulo: doc.title, ld, vue, corpo };
  }

  async function gz(texto) {
    const cs = new CompressionStream("gzip");
    const stream = new Blob([texto]).stream().pipeThrough(cs);
    return await new Response(stream).blob();
  }

  window.baixar = async () => {
    const blob = await gz(JSON.stringify(estado));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prozis_teste.json.gz";
    document.body.appendChild(a);
    a.click();
    console.log(`✅ Descarregado prozis_dados.json.gz (${(blob.size / 1e6).toFixed(1)} MB) — envia ao Claude.`);
  };

  // 1) categorias
  for (const cat of CATEGORIAS) {
    let total = 1;
    for (let n = 1; n <= 1; n++) {
      const url = `${cat}?ls=popularity&pp=100&page=${n}`;
      const html = await obter(url);
      await dormir(ESPERA + Math.random() * 1000);
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
      console.log(`📂 ${cat} — página ${n}/${total}: ${novos} produtos novos (total ${Object.keys(estado.produtos).length})`);
    }
  }

  // 2) páginas de produto — abertas num iframe invisível para o site desenhar a tabela nutricional
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
    const w = frame.contentWindow, d = frame.contentDocument;
    if (!d || !d.body) return null;
    if (/Just a moment|cf-chl|challenges\.cloudflare/i.test(d.documentElement.innerHTML.slice(0, 20000))) return "bloqueado";
    // esperar que a página desenhe o conteúdo
    for (let k = 0; k < 20; k++) {
      if (/Informa[çc][ãa]o Nutricional|Ingredientes|Valor energ|Energia/i.test(d.body.innerText)) break;
      await dormir(500);
    }
    // abrir separadores/acordeões de informação nutricional e ingredientes
    const alvos = [...d.querySelectorAll("button,a,div,span,li,h2,h3")].filter((n) =>
      n.children.length < 4 && /^(Informa[çc][ãa]o Nutricional|Tabela Nutricional|Ingredientes|Modo de Utiliza|Al[ée]rg|Composi[çc][ãa]o)/i.test((n.innerText || "").trim()));
    for (const n of alvos.slice(0, 8)) { try { n.click(); } catch (e) {} await dormir(400); }
    await dormir(1500);
    const tabelas = [...d.querySelectorAll("table")].map((t) => t.outerHTML);
    const texto = d.body.innerText;
    // dados que o site carregou por trás (pedidos JSON)
    const pedidos = [];
    try {
      const ents = w.performance.getEntriesByType("resource").filter((e) => ["xmlhttprequest", "fetch"].includes(e.initiatorType) && e.name.includes("prozis.com"));
      for (const e of ents.slice(0, 15)) {
        try {
          const r = await fetch(e.name, { credentials: "include" });
          const t = await r.text();
          if (t.length < 400000 && /nutri|ingred|kcal|energ|alerg|allerg/i.test(t)) pedidos.push({ url: e.name, corpo: t });
        } catch (err) {}
      }
    } catch (err) {}
    const ld = [...d.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);
    return { titulo: d.title, ld, tabelas, texto: texto.slice(0, 60000), pedidos };
  }

  const lista = Object.values(estado.produtos).slice(0, 3);
  console.log(`\n🔎 ${lista.length} produtos encontrados. A recolher cada um (demora)...`);
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
    const temTabela = r && r.tabelas && r.tabelas.length;
    console.log(`[${i}/${lista.length}] ${p.pagina ? "ok" : "falhou"}${temTabela ? " (tabela ✔)" : ""} — ${p.nome}`);
    document.title = `Prozis ${i}/${lista.length}`;
    if (i % 100 === 0) await window.baixar();   // cópia de segurança a cada 100 produtos
    await dormir(ESPERA + Math.random() * 1000);
  }

  console.log(`\n🏁 Terminado. ${estado.erros.length} páginas falharam.`);
  await window.baixar();
})();
