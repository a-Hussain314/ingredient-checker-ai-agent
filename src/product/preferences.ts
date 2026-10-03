// Each description tells the model what the preference means in practice,
// so a single checkbox in the page expands into a precise brief.
export const PREFERENCES = {
  halal:
    'Halal: avoids pork and its derivatives (including gelatin, lard and pig-derived emulsifiers), alcohol only when it is actually listed (wine, beer, liqueur, rum, alcohol-based extracts), and meat that is not halal-slaughtered. Flag animal-derived ingredients whose source is not stated.',
  gluten_free:
    'Gluten-free: avoids wheat, barley, rye, spelt and any other gluten-containing ingredient. Flag oats and products without a gluten-free statement, and note cross-contamination risk.',
  nut_allergy:
    'Nut allergy: avoids tree nuts (almonds, hazelnuts, walnuts, cashews, pistachios...) and peanuts, plus derivatives such as marzipan, praline and nut oils. "May contain traces" statements matter.',
  dairy_free:
    'Dairy-free: avoids milk and milk derivatives (whey, casein, lactose, butter, ghee, cream) and "may contain milk" statements.',
  vegan:
    'Vegan: avoids every animal-derived ingredient (meat, fish, dairy, eggs, honey, gelatin, carmine E120, shellac E904, animal-sourced L-cysteine E920). Flag ambiguous ones such as E471 and glycerol when their source is not stated.',
} as const;

export type PreferenceKey = keyof typeof PREFERENCES;

export function isPreferenceKey(value: unknown): value is PreferenceKey {
  return typeof value === 'string' && Object.hasOwn(PREFERENCES, value);
}
