const REPORTS: Record<string, string> = {
  "19950017584": "Microgravity Combustion Science: 1995 Program Update",
  "19970009350":
    "Overview of Microgravity Combustion Research at NASA Lewis Research Center and its Potential Commercial Impact",
  "20000030678":
    "Cooperative Research Projects in the Microgravity Combustion Science Programs Sponsored by NASA and NEDO",
  "20120015928": "FLEX: A Decisive Step Forward in NASA's Combustion Research Program",
  "20130014061": "Methanol Droplet Combustion in Oxygen-Inert Environments in Microgravity",
  "20140009169": "Gaseous Non-Premixed Flame Research Planned for the International Space Station",
  "20140011099":
    "Thickness and Fuel Preheating Effects on Material Flammability in Microgravity from the BASS Experiment",
  "20140016804":
    "Overview of the Microgravity Science Glovebox (MSG) Facility and the Research Performed in the MSG",
  "20150008961": "Microgravity Flammability of PMMA Rods in Concurrent Flow",
  "20150023456":
    "Detailed Results From the Flame Extinguishment Experiment (FLEX), March 2009 to December 2011",
  "20160000593": "Combustion of Solids in Microgravity: Results from the BASS-II Experiment",
  "20170006615":
    "Mixed Convection Blowoff Limits as a Function of Oxygen Concentration and Upward Forced Stretch Rate for Burning PMMA Rods of Various Sizes",
  "20170008723": "Annual Highlights of Results from the International Space Station, 2015–2016",
  "20200000361": "Solid Fuel Ignition and Extinction (SoFIE) Project on ISS",
  "20210011385": "Burning and Suppression of Solids II (BASS-II) Summary Report",
  "20210022402": "Solid Fuel Combustion in Partial and Micro-Gravity",
};

export const ntrsId = (docId: string) => docId.match(/\d{11}/)?.[0] ?? null;

export function reportTitle(docId: string): string {
  const id = ntrsId(docId);
  if (id && REPORTS[id]) return REPORTS[id];
  return docId.replace(/^NTRS-/, "").replace(/-/g, " ");
}
