// Recolha HSN no browser — DB Alimentar NUTS
// Colar na Consola do Chrome/Edge com https://www.hsnstore.pt aberto (cookies aceites).
// No fim descarrega "hsn_dados.json.gz" (e cópias de segurança a cada 200 produtos). Envia o último ao Claude.
// Para descarregar a meio: escrever  baixar()  na consola.
(async () => {
  const BASE = "https://www.hsnstore.pt";
  const CATEGORIAS = [
    "/nutricao-desportiva/proteinas", "/nutricao-desportiva/creatina", "/nutricao-desportiva/aminoacidos",
    "/nutricao-desportiva/suplementos-pre-treino", "/nutricao-desportiva/intra-treino", "/nutricao-desportiva/pos-treino-e-recuperacao",
    "/nutricao-desportiva/hidratos-de-carbono", "/nutricao-desportiva/geis-energeticos", "/nutricao-desportiva/aumentadores-de-peso",
    "/nutricao-desportiva/anabolicos-naturais", "/nutricao-desportiva/controlar-peso", "/nutricao-desportiva/vitaminas",
    "/nutricao-desportiva/minerais", "/nutricao-desportiva/multivitaminicos", "/nutricao-desportiva/essenciais", "/nutricao-desportiva",
    "/saude-bem-estar/acidos-gordos-essenciais", "/saude-bem-estar/alergia", "/saude-bem-estar/antioxidantes",
    "/saude-bem-estar/circulacao-coracao", "/saude-bem-estar/concentracao-e-memoria", "/saude-bem-estar/contra-colesterol",
    "/saude-bem-estar/depurativos", "/saude-bem-estar/diabeticos", "/saude-bem-estar/digestao", "/saude-bem-estar/energizantes-naturais",
    "/saude-bem-estar/equilibrio-emocional", "/saude-bem-estar/especial-homem", "/saude-bem-estar/especial-mulher",
    "/saude-bem-estar/especial-seniores", "/saude-bem-estar/essenciais", "/saude-bem-estar/extratos-e-plantas/algas-e-fungos",
    "/saude-bem-estar/micronutrientes-naturais", "/saude-bem-estar/nutricosmeticos", "/saude-bem-estar/ossos-e-articulacoes",
    "/saude-bem-estar/pele-cabelo-e-unhas", "/saude-bem-estar/perder-peso", "/saude-bem-estar/protetores-hepaticos",
    "/saude-bem-estar/saude-ocular", "/saude-bem-estar/saude-respiratoria", "/saude-bem-estar/sistema-imunitario",
    "/saude-bem-estar/sistema-urinario", "/saude-bem-estar/sono-descanso", "/saude-bem-estar/stress-ansiedade", "/saude-bem-estar",
  ];
  const ESPERA = 1500;
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const estado = { produtos: {}, erros: [] };
  window.__hsn = estado;

  async function obter(url) {
    let espera = 60000;
    for (let t = 0; t < 8; t++) {
      try {
        const r = await fetch(url, { credentials: "include" });
        const txt = await r.text();
        if (r.status === 200 && !/challenges\.cloudflare\.com|cf-chl-|Just a moment/i.test(txt.slice(0, 5000))) return txt;
        if (r.status === 404) return null;
        console.warn(`⚠️ ${r.status} em ${url} — a esperar ${espera / 1000}s`);
      } catch (e) { console.warn("⚠️ falha de ligação", e); }
      await dormir(espera);
      espera = Math.min(espera * 2, 600000);
    }
    estado.erros.push(url);
    return null;
  }

  const limpo = (no) => {
    const c = document.createElement("div");
    if (no.nodeType === 11) c.appendChild(no.cloneNode(true)); else c.appendChild(no.cloneNode(true));
    c.querySelectorAll("svg,script,style,img,button,noscript,picture,video,iframe").forEach((n) => n.remove());
    c.querySelectorAll("*").forEach((n) => { for (const a of [...n.attributes]) if (a.name !== "x-if") n.removeAttribute(a.name); });
    // template inside template: include its content as plain html
    c.querySelectorAll("template").forEach((t) => { const d = document.createElement("div"); d.appendChild(t.content.cloneNode(true)); t.replaceWith(d); });
    return c.innerHTML.replace(/\s+/g, " ").replace(/<(\w+)>\s*<\/\1>/g, "").trim();
  };

  function extrair(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const p = { url };
    p.nome = (doc.querySelector("h1")?.textContent || "").trim();
    p.titulo = doc.title;
    p.ld = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).filter((t) => /Product|Breadcrumb/.test(t));
    p.opcoes = [...doc.querySelectorAll("select option")].filter((o) => o.value && /^\d+$/.test(o.value)).map((o) => [o.value, o.textContent.trim()]);
    const vistos = new Set();
    p.info = [];
    const todos = [];
    const juntar = (raiz) => { for (const t of raiz.querySelectorAll("template")) { todos.push(t); juntar(t.content); } };
    juntar(doc);
    for (const t of todos) {
      const xi = t.getAttribute("x-if") || "";
      if (!/productInformationSelected/.test(xi)) continue;
      const h = limpo(t.content);
      const chave = h.replace(/\d{4,}/g, "");
      if (!h || vistos.has(chave)) continue;
      vistos.add(chave);
      if (p.info.length >= 12) break;   // chega de sabores: a tabela é praticamente igual
      p.info.push({ id: (xi.match(/(\d+)/) || [])[1], html: h.slice(0, 40000) });
    }
    if (!p.info.length) {
      // produtos sem variantes: secção "Informações nutricionais" diretamente na página
      const hs = [...doc.querySelectorAll("h2,h3")].filter((n) => /Informa[çc][õo]es nutricionais|Ingredientes/i.test(n.textContent));
      for (const n of hs) {
        let box = n; for (let k = 0; k < 4 && box.parentElement; k++) box = box.parentElement;
        const h = limpo(box);
        if (h && !vistos.has(h)) { vistos.add(h); p.info.push({ id: null, html: h.slice(0, 40000) }); }
      }
    }
    // descrição / modo de uso (texto curto) e migalhas
    const desc = [...doc.querySelectorAll("h2,h3")].filter((n) => /Modo de (uso|utiliza)|Como tomar|Dose recomendada/i.test(n.textContent));
    p.uso = desc.map((n) => (n.parentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1500));
    p.migalhas = [...doc.querySelectorAll('nav[aria-label*="readcrumb"] a, .breadcrumbs a')].map((a) => a.textContent.trim()).filter(Boolean);
    return p;
  }
  window.__hsnExtrair = extrair;

  async function gz(texto) {
    const stream = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).blob();
  }
  window.baixar = async () => {
    const blob = await gz(JSON.stringify(estado));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hsn_dados.json.gz";
    document.body.appendChild(a);
    a.click();
    console.log(`✅ Descarregado hsn_dados.json.gz (${(blob.size / 1e6).toFixed(1)} MB)`);
  };

  // 1) listas das categorias (todas as páginas)
  const RX_PROD = /^https:\/\/www\.hsnstore\.pt\/marcas\/[^\/?#]+\/[^\/?#]+$/;
  for (const cat of CATEGORIAS) {
    for (let n = 1; n <= 80; n++) {
      const html = await obter(`${BASE}${cat}?p=${n}&product_list_limit=48`);
      await dormir(ESPERA);
      if (!html) break;
      const doc = new DOMParser().parseFromString(html, "text/html");
      const links = [...doc.querySelectorAll("a.product-item-link, a.product-item-photo")].map((a) => a.href.replace(location.origin, BASE).split("?")[0]).filter((u) => RX_PROD.test(u));
      let novos = 0, nestaPagina = new Set(links);
      for (const u of nestaPagina) if (!estado.produtos[u]) { estado.produtos[u] = { url: u, categoria: cat }; novos++; }
      const total = (doc.querySelector("#toolbar-amount")?.textContent || "").trim();
      console.log(`📂 ${cat} — página ${n} (${total}): ${novos} novos (total ${Object.keys(estado.produtos).length})`);
      if (!nestaPagina.size || (n > 1 && !novos)) break;
    }
  }

  // 2) cada produto
  const lista = Object.values(estado.produtos);
  console.log(`\n🔎 ${lista.length} produtos. A recolher cada um (pode demorar 1-2 horas; deixa este separador aberto)...`);
  let i = 0;
  for (const p of lista) {
    i++;
    const html = await obter(p.url);
    if (html) {
      try { Object.assign(p, extrair(html, p.url)); } catch (e) { p.erro = String(e); }
    } else estado.erros.push(p.url);
    const ok = p.info && p.info.some((x) => /kcal|Ingredientes|Tamanho da dose/i.test(x.html));
    console.log(`[${i}/${lista.length}] ${html ? "ok" : "falhou"}${ok ? " (tabela ✔)" : ""} — ${p.nome || p.url}`);
    document.title = `HSN ${i}/${lista.length}`;
    if (i % 200 === 0) await window.baixar();
    await dormir(ESPERA);
  }
  console.log(`\n🏁 Terminado. ${estado.erros.length} falharam. A descarregar o ficheiro final...`);
  await window.baixar();
})();
