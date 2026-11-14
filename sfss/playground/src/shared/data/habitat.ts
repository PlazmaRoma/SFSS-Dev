import type { Atmosphere, Lang } from "../types";

export type MaterialKey = "pmma" | "sibal" | "nomex";

export interface Module {
  id: string;
  name: Record<Lang, string>;
  role: Record<Lang, string>;
  atmosphere: Atmosphere;
  materials: MaterialKey[];
  note?: Record<Lang, string>;
}

const SEA_LEVEL = 14.7;

export const HABITAT: Module[] = [
  {
    id: "crew",
    name: { en: "Crew Quarters", ru: "Жилой модуль" },
    role: { en: "Sleep and off-duty", ru: "Сон и отдых" },
    atmosphere: { oxygen_level: 0.21, pressure_psi: SEA_LEVEL, droplet_mm: 3.0 },
    materials: ["sibal", "nomex"],
  },
  {
    id: "lab",
    name: { en: "Laboratory", ru: "Лаборатория" },
    role: { en: "Science payloads", ru: "Научная аппаратура" },
    atmosphere: { oxygen_level: 0.21, pressure_psi: SEA_LEVEL, droplet_mm: 3.0 },
    materials: ["pmma", "nomex"],
  },
  {
    id: "galley",
    name: { en: "Galley", ru: "Камбуз" },
    role: { en: "Food preparation", ru: "Приготовление пищи" },
    atmosphere: { oxygen_level: 0.21, pressure_psi: SEA_LEVEL, droplet_mm: 3.0 },
    materials: ["pmma", "sibal"],
  },
  {
    id: "eva",
    name: { en: "EVA Prep", ru: "Шлюз" },
    role: { en: "Suit-up and airlock", ru: "Подготовка к выходу" },
    atmosphere: { oxygen_level: 0.34, pressure_psi: 8.2, droplet_mm: 3.0 },
    materials: ["nomex", "pmma"],
    note: {
      en: "NASA's proposed exploration atmosphere: 8.2 psi at 34% oxygen, chosen to cut EVA prebreathe time.",
      ru: "Штатная «разведочная атмосфера» NASA: 8.2 psi при 34% кислорода, чтобы сократить предварительное дыхание перед выходом.",
    },
  },
  {
    id: "storage",
    name: { en: "Storage", ru: "Склад" },
    role: { en: "Consumables and spares", ru: "Расходники и ЗИП" },
    atmosphere: { oxygen_level: 0.21, pressure_psi: SEA_LEVEL, droplet_mm: 3.0 },
    materials: ["pmma", "sibal"],
  },
  {
    id: "greenhouse",
    name: { en: "Greenhouse", ru: "Оранжерея" },
    role: { en: "Crop growth", ru: "Выращивание растений" },
    atmosphere: { oxygen_level: 0.24, pressure_psi: SEA_LEVEL, droplet_mm: 3.0 },
    materials: ["sibal"],
    note: {
      en: "Photosynthesis raises oxygen above cabin nominal unless the module is actively scrubbed.",
      ru: "Фотосинтез поднимает кислород выше штатного, если модуль не продувать отдельно.",
    },
  },
];

export const BASELINE: Atmosphere = {
  oxygen_level: 0.21,
  pressure_psi: SEA_LEVEL,
  droplet_mm: 3.0,
};

export const MATERIAL_LABEL: Record<MaterialKey, Record<Lang, string>> = {
  pmma: { en: "Acrylic panel (PMMA)", ru: "Панель из оргстекла (PMMA)" },
  sibal: { en: "SIBAL fabric", ru: "Ткань SIBAL" },
  nomex: { en: "Nomex lining", ru: "Обшивка из номекса" },
};
