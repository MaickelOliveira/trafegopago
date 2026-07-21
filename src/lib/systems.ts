export type SystemSlug = "pousada"; // adicionar novos slugs aqui no futuro (ex: "cardapio")

export const AVAILABLE_SYSTEMS: { slug: SystemSlug; label: string; icon: string; desc: string }[] = [
  { slug: "pousada", label: "Pousada", icon: "🏡", desc: "Reservas, hospedagem, day use e eventos" },
];
