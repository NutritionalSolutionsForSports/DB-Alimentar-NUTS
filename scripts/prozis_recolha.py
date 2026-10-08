# -*- coding: utf-8 -*-
"""
Recolha das páginas de produtos da Prozis (suplementação) para a DB Alimentar NUTS.

O QUE FAZ
  1. Visita as categorias da Prozis indicadas em CATEGORIAS (todas as páginas de cada uma).
  2. Junta a lista de todos os produtos encontrados.
  3. Descarrega a página de cada produto para a pasta "prozis_paginas".
  4. No fim cria o ficheiro "prozis_paginas.zip" — é esse ficheiro que deves enviar ao Claude.

COMO CORRER
  - Windows: instala o Python em https://www.python.org/downloads/ (marca "Add Python to PATH").
    Depois abre a pasta onde guardaste este ficheiro, escreve "cmd" na barra de endereço e carrega Enter.
    Na janela preta escreve:   python prozis_recolha.py
  - Mac: abre o Terminal na pasta do ficheiro e escreve:   python3 prozis_recolha.py

  Demora algum tempo (espera ~1,5 s entre páginas para não sobrecarregar o site).
  Se for interrompido, basta voltar a correr: continua de onde parou.
  Não precisa de instalar nada além do Python.
"""
import os, re, sys, time, gzip, zipfile, hashlib, random
import urllib.request, urllib.error
from urllib.parse import urljoin, urlparse, urlencode, parse_qsl, urlunparse

CATEGORIAS = [
    "https://www.prozis.com/pt/pt/nutricao-desportiva/proteina",
    "https://www.prozis.com/pt/pt/nutricao-desportiva/queimadores-de-gordura-e-definicao-muscular",
    "https://www.prozis.com/pt/pt/nutricao-desportiva/desenvolvimento-muscular",
    "https://www.prozis.com/pt/pt/nutricao-desportiva/pre-intra-e-pos-treino",
    "https://www.prozis.com/pt/pt/nutricao-desportiva/saude-do-atleta",
    "https://www.prozis.com/pt/pt/nutricao-desportiva/energia-e-resistencia",
    "https://www.prozis.com/pt/pt/nutricao-desportiva/com-certificado-doping-free",
    "https://www.prozis.com/pt/pt/saude-e-emagrecimento/colagenio",
    "https://www.prozis.com/pt/pt/saude-e-emagrecimento/perda-de-peso",
    "https://www.prozis.com/pt/pt/saude-e-emagrecimento/saude",
    "https://www.prozis.com/pt/pt/saude-e-emagrecimento/vitaminas-minerais-e-ervas",
]

PASTA = "prozis_paginas"
ESPERA = 1.5          # segundos entre pedidos
MAX_PAGINAS_CAT = 60  # limite de páginas por categoria

# Primeiros segmentos de caminho que são secções/categorias (não produtos)
SECCOES = {
    "nutricao-desportiva", "saude-e-emagrecimento", "alimentacao-saudavel", "vestuario",
    "roupa", "moda", "desporto", "acessorios", "equipamento", "casa", "tecnologia",
    "beleza", "cosmetica", "marcas", "brands", "promocoes", "outlet", "blog", "ajuda",
    "help", "account", "conta", "checkout", "cart", "carrinho", "search", "pesquisa",
    "info", "sobre", "c", "l", "lp", "campaign", "campanhas",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip",
}


def log(*a):
    print(*a, flush=True)


def obter(url, tentativas=4):
    """Descarrega uma página. Devolve (codigo, texto)."""
    espera_429 = 60
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as r:
                dados = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    dados = gzip.decompress(dados)
                return r.status, dados.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, ""
            if e.code == 429 or e.code == 403:
                log(f"   ! O site pediu para abrandar ({e.code}). A esperar {espera_429}s...")
                time.sleep(espera_429)
                espera_429 *= 2
                continue
            log(f"   ! Erro {e.code} em {url}")
            time.sleep(5)
        except Exception as e:
            log(f"   ! Falha de ligação ({e}). A tentar outra vez...")
            time.sleep(5 * (t + 1))
    return 0, ""


def com_pagina(url, n):
    p = urlparse(url)
    q = dict(parse_qsl(p.query))
    q["page"] = str(n)
    return urlunparse(p._replace(query=urlencode(q)))


def links_produto(html, base):
    """Extrai links que parecem páginas de produto: /pt/pt/<marca>/<produto>"""
    out = set()
    for href in re.findall(r'href="([^"#]+)"', html):
        u = urljoin(base, href.split("?")[0])
        p = urlparse(u)
        if p.netloc != "www.prozis.com":
            continue
        partes = [x for x in p.path.split("/") if x]
        if len(partes) == 4 and partes[0] == "pt" and partes[1] == "pt" and partes[2] not in SECCOES:
            out.add(f"https://www.prozis.com/{'/'.join(partes)}")
    return out


def nome_ficheiro(url):
    return hashlib.md5(url.encode()).hexdigest() + ".html"


def main():
    os.makedirs(PASTA, exist_ok=True)
    lista_path = os.path.join(PASTA, "_produtos.tsv")

    # ---------- 1) Categorias ----------
    produtos = {}
    if os.path.exists(lista_path):
        for linha in open(lista_path, encoding="utf-8"):
            u, c = linha.rstrip("\n").split("\t")
            produtos[u] = c
        log(f"Lista de produtos já existente: {len(produtos)} produtos (a reutilizar).")
    else:
        for cat in CATEGORIAS:
            log(f"\nCategoria: {cat}")
            vistos = set()
            for n in range(1, MAX_PAGINAS_CAT + 1):
                url = cat if n == 1 else com_pagina(cat, n)
                cod, html = obter(url)
                time.sleep(ESPERA + random.random())
                if cod != 200 or not html:
                    log(f"   página {n}: sem resposta (código {cod})")
                    break
                # guarda também a página da categoria (útil para o Claude)
                with open(os.path.join(PASTA, "cat_" + nome_ficheiro(url)), "w", encoding="utf-8") as f:
                    f.write(f"<!-- URL: {url} -->\n" + html)
                novos = links_produto(html, url) - vistos
                log(f"   página {n}: {len(novos)} produtos novos")
                if not novos:
                    break
                vistos |= novos
            for u in vistos:
                produtos.setdefault(u, cat)
        with open(lista_path, "w", encoding="utf-8") as f:
            for u, c in sorted(produtos.items()):
                f.write(f"{u}\t{c}\n")
        log(f"\nTotal de produtos encontrados: {len(produtos)}")

    if not produtos:
        log("\nNão foram encontrados produtos. Envia ao Claude a pasta 'prozis_paginas' "
            "(tem as páginas das categorias) para ele perceber o que se passa.")

    # ---------- 2) Páginas de produto ----------
    feitos = 0
    for i, (u, c) in enumerate(sorted(produtos.items()), 1):
        destino = os.path.join(PASTA, nome_ficheiro(u))
        if os.path.exists(destino) and os.path.getsize(destino) > 5000:
            continue
        cod, html = obter(u)
        if cod == 200 and html:
            with open(destino, "w", encoding="utf-8") as f:
                f.write(f"<!-- URL: {u} -->\n<!-- CATEGORIA: {c} -->\n" + html)
            feitos += 1
        log(f"[{i}/{len(produtos)}] {cod} {u}")
        time.sleep(ESPERA + random.random())

    # ---------- 3) ZIP ----------
    zip_path = "prozis_paginas.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for nome in os.listdir(PASTA):
            z.write(os.path.join(PASTA, nome), arcname=os.path.join(PASTA, nome))
    tam = os.path.getsize(zip_path) / 1e6
    log(f"\nConcluído! Ficheiro criado: {os.path.abspath(zip_path)} ({tam:.1f} MB)")
    log("Envia este ficheiro ao Claude na conversa.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\nInterrompido. Volta a correr o mesmo comando para continuar de onde parou.")
        sys.exit(1)
