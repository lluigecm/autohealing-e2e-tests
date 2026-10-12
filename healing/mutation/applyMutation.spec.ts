import { test, expect, Page } from '@playwright/test';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { categoriasAmostradas } from '../../tests/fixtures/amostras';
import { CATALOG, findMutation } from '../../mutation/catalog';
import {
  MutationPlan,
  applyMutation,
  installDocumentRewrite,
  mutateDocument,
  planOf,
  pointsToOracle,
  readMutationState,
} from '../../mutation/applyMutation';
import { MutationSpec } from '../../mutation/types';

/**
 * Unitários da transformação, sem rede. As fixtures reproduzem a
 * estrutura do books.toscrape.com nos pontos que os seletores do catálogo
 * tocam, e — como o site real — não têm nenhum `data-*`/`aria-*`.
 * Moram sob `healing/` só por causa do `testDir` da config unitária.
 */

const SIDEBAR = `
  <aside class="sidebar col-sm-4 col-md-3">
    <div class="side_categories">
      <ul class="nav nav-list">
        <li>
          <a href="catalogue/category/books_1/index.html">Books</a>
          <ul>
            ${categoriasAmostradas
              .map((c) => `<li><a href="catalogue/category/books/${c.slug}/index.html">\n  ${c.nome}\n</a></li>`)
              .join('\n')}
          </ul>
        </li>
      </ul>
    </div>
  </aside>`;

function card(title: string, price: string): string {
  return `<li><article class="product_pod">
    <div class="image_container"><a href="x/index.html"><img src="x.jpg" alt="${title}"></a></div>
    <p class="star-rating Three"><i class="icon-star"></i></p>
    <h3><a href="x/index.html" title="${title}">${title}</a></h3>
    <div class="product_price"><p class="price_color">${price}</p></div>
  </article></li>`;
}

const LISTING = `<!doctype html><html><body id="default" class="default">
  <div class="container-fluid page"><div class="page_inner"><div class="row">
    ${SIDEBAR}
    <div class="col-sm-8 col-md-9">
      <div class="page-header action"><h1>All products</h1></div>
      <section><ol class="row">
        ${card("It's Only the Himalayas", '£45.17')}
        ${card('Full Moon over Noah’s Ark', '£49.43')}
        ${card('See America', '£48.87')}
      </ol>
      <ul class="pager"><li class="current">Page 1 of 50</li><li class="next"><a href="page-2.html">next</a></li></ul>
      </section>
    </div>
  </div></div></div>
</body></html>`;

const PRODUCT = `<!doctype html><html><body id="default" class="default">
  <div class="container-fluid page"><div class="page_inner"><div class="content">
    <article class="product_page"><div class="row">
      <div class="col-sm-6"><div id="product_gallery"><img src="x.jpg" alt="x"></div></div>
      <div class="col-sm-6 product_main">
        <h1>It's Only the Himalayas</h1>
        <p class="price_color">£45.17</p>
        <p class="instock availability"><i class="icon-ok"></i> In stock (19 available)</p>
        <p class="star-rating Two"><i class="icon-star"></i></p>
        <hr>
      </div>
    </div></article>
  </div></div></div>
</body></html>`;

/** Página da própria categoria Travel: lá o link vira `index.html` com `<strong>`. */
const TRAVEL_OWN_PAGE = LISTING.replace(
  /<a href="catalogue\/category\/books\/travel_2\/index.html">[^<]*<\/a>/,
  '<a href="index.html"><strong>Travel</strong></a>',
);

const PRODUCT_TARGETS = new Set(['T7', 'T8', 'T9', 'T10']);

function fixtureFor(spec: MutationSpec): string {
  return PRODUCT_TARGETS.has(spec.target.id) ? PRODUCT : LISTING;
}

/** Disponibiliza `mutateDocument` na página — é a mesma função que vai no init script. */
async function load(page: Page, html: string): Promise<void> {
  await page.setContent(html);
  await page.addScriptTag({ content: `window.__mutateDocument = ${mutateDocument.toString()};` });
}

interface Outcome {
  applied: boolean;
  oracleIsNull: boolean;
  /** O oráculo é o mesmo objeto que o seletor resolvia antes da mutação. */
  oracleIsOriginalTarget: boolean;
  html: string;
  injectedAttributes: string[];
}

async function run(page: Page, plan: MutationPlan): Promise<Outcome> {
  return page.evaluate((p) => {
    const w = window as unknown as Record<string, any>;
    const before = document.querySelector(p.selector);
    w.__mutateDocument(p);
    const state = w[p.stateKey];
    const injectedAttributes = Array.from(document.querySelectorAll('*')).flatMap((el) =>
      Array.from(el.attributes)
        .map((attr) => attr.name)
        .filter((name) => name.startsWith('data-') || name.startsWith('aria-')),
    );
    return {
      applied: state.applied,
      oracleIsNull: state.oracle === null,
      oracleIsOriginalTarget: state.oracle !== null && state.oracle === before,
      html: document.body.outerHTML,
      injectedAttributes,
    };
  }, plan);
}

async function bodyHtml(page: Page): Promise<string> {
  return page.evaluate(() => document.body.outerHTML);
}

// Um teste só para as 103 entradas, com asserções rotuladas pelo id: um teste
// por entrada inflaria o número de unitários citado no texto com uma única
// verificação repetida.
test('todas as entradas aplicam, definem o oráculo e não injetam data-*/aria-*', async ({ page }) => {
  for (const spec of CATALOG) {
    await load(page, fixtureFor(spec));
    const before = await bodyHtml(page);

    const outcome = await run(page, planOf(spec));

    expect.soft(outcome.applied, spec.id).toBe(true);
    expect.soft(outcome.html, spec.id).not.toBe(before);
    expect.soft(outcome.injectedAttributes, spec.id).toEqual([]);
    if (spec.meta.class === 'defect') {
      expect.soft(outcome.oracleIsNull, spec.id).toBe(true);
    } else {
      expect.soft(outcome.oracleIsOriginalTarget, spec.id).toBe(true);
    }
  }
});

test('determinismo: duas aplicações sobre o mesmo DOM produzem o mesmo DOM', async ({ page }) => {
  for (const spec of CATALOG) {
    await load(page, fixtureFor(spec));
    const first = (await run(page, planOf(spec))).html;
    await load(page, fixtureFor(spec));
    const second = (await run(page, planOf(spec))).html;
    expect.soft(second, spec.id).toBe(first);
  }
});

test.describe('efeito de cada tipo', () => {
  test('M1 reescreve class e id, definindo-os quando ausentes', async ({ page }) => {
    await load(page, PRODUCT);
    await run(page, planOf(findMutation('M1-T8')));
    const price = page.locator('.product_main > p:nth-of-type(1)');
    expect(await price.getAttribute('class')).toBe('m1-price_color');
    expect(await price.getAttribute('id')).toBe('m1-M1-T8');

    await load(page, PRODUCT);
    await run(page, planOf(findMutation('M1-T10')));
    expect(await page.locator('.product_main > p:nth-of-type(3)').getAttribute('class')).toBe('m1-star-rating m1-Two');

    await load(page, PRODUCT);
    await run(page, planOf(findMutation('M1-T7')));
    const title = page.locator('.product_main > h1');
    expect(await title.getAttribute('class')).toBe('m1');
    expect(await title.getAttribute('id')).toBe('m1-M1-T7');
  });

  test('M2 relabel troca o texto inteiro', async ({ page }) => {
    await load(page, LISTING);
    await run(page, planOf(findMutation('M2-T1-travel_2-relabel')));
    expect(await page.locator('a[href$="/travel_2/index.html"]').textContent()).toBe('Viagem');

    await load(page, LISTING);
    await run(page, planOf(findMutation('M2-T4-relabel')));
    expect(await page.locator('li.next > a').textContent()).toBe('próxima');
  });

  test('M2 append-token acrescenta um token ao texto normalizado', async ({ page }) => {
    await load(page, LISTING);
    await run(page, planOf(findMutation('M2-T1-sequential-art_5-append-token')));
    expect(await page.locator('a[href$="/sequential-art_5/index.html"]').textContent()).toBe('Sequential Art Comics');
  });

  test('M2 drop-last-token remove o último token', async ({ page }) => {
    await load(page, LISTING);
    await run(page, planOf(findMutation('M2-T3-drop-last-token')));
    const link = page.locator('ol.row > li:first-child h3 > a');
    expect(await link.textContent()).toBe("It's Only the");
    expect(await link.getAttribute('title')).toBe("It's Only the Himalayas");
  });

  test('M3 inverte os filhos do grupo e o oráculo acompanha o elemento', async ({ page }) => {
    await load(page, LISTING);
    const outcome = await run(page, planOf(findMutation('M3-T2')));
    expect(outcome.oracleIsOriginalTarget).toBe(true);
    expect(await page.locator('ol.row h3 > a').allTextContents()).toEqual([
      'See America',
      'Full Moon over Noah’s Ark',
      "It's Only the Himalayas",
    ]);
  });

  test('M4 envolve o alvo num div sem atributos, na mesma posição', async ({ page }) => {
    await load(page, PRODUCT);
    await run(page, planOf(findMutation('M4-T8')));
    const wrapper = await page.evaluate(() => {
      const price = document.querySelector('p.price_color')!;
      const parent = price.parentElement!;
      return {
        tag: parent.tagName,
        attributes: parent.attributes.length,
        onlyChild: parent.children.length === 1,
        index: Array.from(parent.parentElement!.children).indexOf(parent),
      };
    });
    expect(wrapper).toEqual({ tag: 'DIV', attributes: 0, onlyChild: true, index: 1 });
  });

  test('M5 remove o alvo e deixa o oráculo nulo', async ({ page }) => {
    await load(page, LISTING);
    const outcome = await run(page, planOf(findMutation('M5-T4')));
    expect(outcome).toMatchObject({ applied: true, oracleIsNull: true });
    expect(await page.locator('li.next > a').count()).toBe(0);
  });
});

test.describe('alvo ausente: applied false e DOM intacto', () => {
  test('alvo de produto numa página de listagem', async ({ page }) => {
    await load(page, LISTING);
    const before = await bodyHtml(page);
    const outcome = await run(page, planOf(findMutation('M5-T8')));
    expect(outcome).toMatchObject({ applied: false, oracleIsNull: true, html: before });
  });

  test('link "Travel" na própria página Travel', async ({ page }) => {
    for (const id of ['M1-T1-travel_2', 'M2-T1-travel_2-relabel', 'M3-T1-travel_2', 'M4-T1-travel_2', 'M5-T1-travel_2']) {
      await load(page, TRAVEL_OWN_PAGE);
      const before = await bodyHtml(page);
      const outcome = await run(page, planOf(findMutation(id)));
      expect(outcome, id).toMatchObject({ applied: false, oracleIsNull: true, html: before });
    }
  });

  test('drop-last-token em texto de um token só', async ({ page }) => {
    await load(page, LISTING);
    const before = await bodyHtml(page);
    const plan: MutationPlan = { ...planOf(findMutation('M2-T3-drop-last-token')), selector: 'li.next > a' };
    expect(await run(page, plan)).toMatchObject({ applied: false, html: before });
  });

  test('grupo do M3 que não contém o alvo', async ({ page }) => {
    await load(page, LISTING);
    const before = await bodyHtml(page);
    const plan: MutationPlan = { ...planOf(findMutation('M3-T4')), group: 'ol.row' };
    expect(await run(page, plan)).toMatchObject({ applied: false, html: before });
  });
});

test.describe('instalação: reescrita do documento antes da entrega', () => {
  // `route.fetch` vai à rede e ignora outros `route`, então as fixtures vêm de
  // um servidor HTTP local, criado aqui — sem acesso à internet.
  let server: Server;
  let origin: string;
  /** Bytes servidos por caminho, para comparar com o que a página recebeu. */
  const BODIES: Record<string, string> = {
    '/index.html': LISTING,
    '/travel/index.html': TRAVEL_OWN_PAGE,
    '/product/index.html': PRODUCT,
    '/lenta/index.html': PRODUCT,
  };

  /** Cargas de `/alterna/index.html`: a primeira responde a listagem, as seguintes 500. */
  let alterna = 0;

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://local').pathname;
      if (pathname === '/alterna/index.html') {
        alterna += 1;
        if (alterna > 1) {
          response.writeHead(500, { 'content-type': 'text/html' }).end('<p>erro</p>');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html' }).end(LISTING);
        return;
      }
      const body = BODIES[pathname];
      if (body === undefined) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      if (pathname === '/lenta/index.html') {
        // Entrega o documento em duas partes: sem a reescrita, o alvo já
        // existiria no DOM antes de o resto chegar.
        const middle = body.indexOf('<p class="instock');
        response.write(body.slice(0, middle));
        setTimeout(() => response.end(body.slice(middle)), 300);
        return;
      }
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('sem mutação instalada não há estado', async ({ page }) => {
    await page.goto(`${origin}/index.html`);
    expect(await readMutationState(page)).toBeNull();
  });

  test('vale em toda navegação e só atua onde o alvo existe', async ({ page }) => {
    await applyMutation(page, findMutation('M1-T1-travel_2'));

    await page.goto(`${origin}/index.html`);
    expect(await readMutationState(page)).toEqual({ id: 'M1-T1-travel_2', applied: true, oracleIsNull: false });
    expect(await page.locator('a[href$="/travel_2/index.html"]').getAttribute('class')).toBe('m1');

    await page.goto(`${origin}/travel/index.html`);
    expect(await readMutationState(page)).toEqual({ id: 'M1-T1-travel_2', applied: false, oracleIsNull: true });

    await page.goto(`${origin}/product/index.html`);
    expect(await readMutationState(page)).toEqual({ id: 'M1-T1-travel_2', applied: false, oracleIsNull: true });
  });

  test('documento sem alvo é entregue com os bytes originais', async ({ page }) => {
    await applyMutation(page, findMutation('M1-T1-travel_2'));
    const response = await page.goto(`${origin}/travel/index.html`);
    expect(await response!.text()).toBe(TRAVEL_OWN_PAGE);
  });

  test('documento com alvo chega já mutado, mesmo entregue aos pedaços', async ({ page }) => {
    await applyMutation(page, findMutation('M1-T8'));
    const navigation = page.goto(`${origin}/lenta/index.html`, { waitUntil: 'commit' });
    await navigation;
    // Lido antes de o documento terminar de chegar: o preço já existe e já está mutado.
    const price = page.locator('.product_main > p:nth-of-type(1)');
    await price.waitFor({ state: 'attached' });
    expect(await price.getAttribute('class')).toBe('m1-price_color');
  });

  test('aplicada no contexto, vale para páginas novas', async ({ context }) => {
    await applyMutation(context, findMutation('M5-T7'));
    const page = await context.newPage();

    await page.goto(`${origin}/product/index.html`);
    expect(await readMutationState(page)).toEqual({ id: 'M5-T7', applied: true, oracleIsNull: true });
    expect(await page.locator('h1').count()).toBe(0);
  });

  test('avisa cada documento entregue, com applied', async ({ page }) => {
    const documentos: Array<{ url: string; applied: boolean }> = [];
    await applyMutation(page, findMutation('M1-T1-travel_2'), { onDocument: (d) => documentos.push(d) });
    await page.goto(`${origin}/index.html`);
    await page.goto(`${origin}/travel/index.html`);
    expect(documentos).toEqual([
      { url: '/index.html', applied: true },
      { url: '/travel/index.html', applied: false },
    ]);
  });

  test('pointsToOracle distingue o oráculo de outro elemento', async ({ page }) => {
    await applyMutation(page, findMutation('M3-T3'));
    await page.goto(`${origin}/index.html`);

    const links = page.getByRole('article').getByRole('heading', { level: 3 }).getByRole('link');
    expect(await pointsToOracle(links.nth(0))).toBe(false);
    expect(await pointsToOracle(links.nth(2))).toBe(true);
  });

  test('duas páginas do mesmo contexto, mutações diferentes na mesma URL: cada uma vê o próprio oráculo', async ({
    context,
  }) => {
    // Como a matriz: entradas medidas em paralelo, em páginas do mesmo contexto.
    const invertida = await context.newPage();
    const intacta = await context.newPage();
    await applyMutation(invertida, findMutation('M3-T3'));
    await applyMutation(intacta, findMutation('M1-T3'));
    await invertida.goto(`${origin}/index.html`);
    await intacta.goto(`${origin}/index.html`);

    const titulos = (page: Page) => page.getByRole('article').getByRole('heading', { level: 3 }).getByRole('link');
    expect(await readMutationState(invertida)).toEqual({ id: 'M3-T3', applied: true, oracleIsNull: false });
    expect(await pointsToOracle(titulos(invertida).nth(2))).toBe(true);
    expect(await pointsToOracle(titulos(invertida).nth(0))).toBe(false);
    expect(await readMutationState(intacta)).toEqual({ id: 'M1-T3', applied: true, oracleIsNull: false });
    expect(await pointsToOracle(titulos(intacta).nth(0))).toBe(true);
  });

  test('nova navegação para a mesma URL não herda o oráculo do carregamento anterior', async ({ page }) => {
    await applyMutation(page, findMutation('M1-T3'));
    const titulo = page.getByRole('article').getByRole('heading', { level: 3 }).getByRole('link').first();

    await page.goto(`${origin}/alterna/index.html`);
    expect(await readMutationState(page)).toEqual({ id: 'M1-T3', applied: true, oracleIsNull: false });
    expect(await pointsToOracle(titulo)).toBe(true);

    // Mesma URL, agora sem documento reescrito: não há estado deste carregamento.
    const segunda = await page.goto(`${origin}/alterna/index.html`);
    expect(segunda!.status()).toBe(500);
    expect(await readMutationState(page)).toBeNull();
    expect(await pointsToOracle(page.locator('p'))).toBe(false);
  });

  test('M5 nunca aponta para o oráculo', async ({ page }) => {
    await applyMutation(page, findMutation('M5-T2'));
    await page.goto(`${origin}/index.html`);

    expect(await pointsToOracle(page.getByRole('article'))).toBe(false);
  });

  test('reserialização sem plano preserva o DOM', async ({ browser }) => {
    const read = async (rewrite: boolean) => {
      const context = await browser.newContext();
      if (rewrite) {
        await installDocumentRewrite(context, null, { reserialize: true });
      }
      const page = await context.newPage();
      await page.goto(`${origin}/index.html`);
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      await context.close();
      return html;
    };
    expect(await read(true)).toBe(await read(false));
  });
});
