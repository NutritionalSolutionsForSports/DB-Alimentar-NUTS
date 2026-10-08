(async () => {
  const ESPERA = 1200;
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1) escolher a última cópia de segurança (prozis_dados (N).json.gz) — botão laranja no topo da página
  const ficheiro = await new Promise((resolve) => {
    const b = document.createElement("button");
    b.textContent = "👉 CLICA AQUI e escolhe o último prozis_dados (…).json.gz";
    b.style.cssText = "position:fixed;top:10px;left:10px;z-index:2147483647;padding:20px 30px;font-size:20px;background:#ff6a00;color:#fff;border:0;border-radius:10px;cursor:pointer;box-shadow:0 4px 20px #0008";
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".gz,.json"; inp.style.display = "none";
    inp.onchange = () => { b.remove(); resolve(inp.files[0]); };
    b.onclick = () => inp.click();
    document.body.append(b, inp);
    console.log("👉 Clica no botão laranja no topo da página e escolhe o ficheiro.");
  });
  let txt;
  if (/\.gz$/i.test(ficheiro.name)) txt = await new Response(ficheiro.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  else txt = await ficheiro.text();
  const estado = JSON.parse(txt);
  window.__prozis = estado;
  const todos = Object.values(estado.produtos);
  const lista = todos.filter((p) => !p.pagina);
  estado.erros = [];
  console.log(`📦 Ficheiro "${ficheiro.name}": ${todos.length} produtos, ${todos.length - lista.length} já recolhidos, faltam ${lista.length}.`);

  // impedir que alguma página de produto faça sair desta página
  window.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; });

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

  // 2) iframe "fechado": a página do produto não consegue mexer nesta página
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
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
    let d;
    try { d = frame.contentDocument; } catch (e) { return null; }
    if (!d || !d.body) return null;
    if (/Just a moment|cf-chl|challenges\.cloudflare/i.test(d.documentElement.innerHTML.slice(0, 20000))) return "bloqueado";
    for (let k = 0; k < 20; k++) {
      if (/Declara[çc][ãa]o Nutricional|Informa[çc][ãa]o Nutricional|Ingredientes/i.test(d.body.innerText)) break;
      await dormir(500);
    }
    const RX = /^(Declara[çc][ãa]o Nutricional|Informa[çc][ãa]o Nutricional|Tabela Nutricional|Ingredientes|Modo de Utiliza[çc][ãa]o|Al[ée]rg[ée]nios|Composi[çc][ãa]o)$/i;
    const alvos = [...d.querySelectorAll("button,a,div,span,li,h2,h3,h4,p")]
      .filter((n) => RX.test((n.innerText || "").trim()))
      .filter((n) => ![...n.children].some((c) => RX.test((c.innerText || "").trim())))
      .filter((n) => { const a = n.closest("a[href]"); return !a || /^(#|javascript:)/.test(a.getAttribute("href")); });
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
    document.title = `Prozis resto ${i}/${lista.length}`;
    if (i % 100 === 0) await window.baixar();
    await dormir(ESPERA);
  }
  console.log(`\n🏁 Terminado. ${estado.erros.length} falharam. A descarregar o ficheiro final...`);
  await window.baixar();
})();
