export interface AmostraCategoria {
  nome: string;
  slug: string;
}

/**
 * Categorias escolhidas por diversidade estrutural real (não só volume):
 * cobrem uma progressão quase monotônica de tamanho de grid (1 a 20+ livros
 * por página) e todas as profundidades de paginação existentes no site
 * (nenhuma, 2, 4 e 8 páginas), além das cinco classes de rating (One..Five)
 * no primeiro produto de cada uma. Contagens verificadas em 2026-09-05
 * direto no HTML de books.toscrape.com (não estimadas).
 */
export const categoriasAmostradas: AmostraCategoria[] = [
  // 1 livro, página única — menor grid possível no site (caso extremo: lista com um item só)
  { nome: 'Crime', slug: 'crime_51' },
  // 2 livros, página única
  { nome: 'Historical', slug: 'historical_42' },
  // 3 livros, página única
  { nome: 'Contemporary', slug: 'contemporary_38' },
  // 4 livros, página única
  { nome: 'Health', slug: 'health_47' },
  // 5 livros, página única
  { nome: 'Biography', slug: 'biography_36' },
  // 6 livros, página única
  { nome: 'Christian Fiction', slug: 'christian-fiction_34' },
  // 7 livros, página única
  { nome: 'Psychology', slug: 'psychology_26' },
  // 8 livros, página única
  { nome: 'Art', slug: 'art_25' },
  // 9 livros, página única
  { nome: 'Autobiography', slug: 'autobiography_27' },
  // 10 livros, página única
  { nome: 'Humor', slug: 'humor_30' },
  // 11 livros, página única
  { nome: 'Travel', slug: 'travel_2' },
  // 13 livros, página única
  { nome: 'Music', slug: 'music_14' },
  // 18 livros, página única — maior grid sem paginação da amostra
  { nome: 'History', slug: 'history_32' },
  // 20 livros na 1ª página, 2 páginas no total — menor caso da amostra com paginação
  { nome: 'Mystery', slug: 'mystery_3' },
  // 20 livros na 1ª página, 4 páginas no total — paginação intermediária
  { nome: 'Sequential Art', slug: 'sequential-art_5' },
  // 20 livros na 1ª página, 8 páginas no total — maior grid paginado do site
  // ("Default" é uma categoria real do site, não um nome de exemplo/placeholder)
  { nome: 'Default', slug: 'default_15' },
];
