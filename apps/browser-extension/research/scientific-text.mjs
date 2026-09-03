const ELEMENTS = new Set(`H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og`.split(" "));
const TOKEN_PATTERN = /(?:cm|mm|µm|μm|nm|kg|mg|µg|μg|mol|s|h|m|g)[−-]\d+|(?:[A-Z][a-z]?(?:\d+(?:\.\d+)?)?)+(?:[+−-])?/g;

function pushRun(runs, text, script = "") {
  if (!text) return;
  const previous = runs.at(-1);
  if (previous?.script === script) previous.text += text;
  else runs.push({ text, script });
}

function parseFormula(value) {
  const charge = value.match(/([+−-])$/)?.[1] || "";
  const base = charge ? value.slice(0, -1) : value;
  const parts = [];
  let cursor = 0;
  while (cursor < base.length) {
    const match = base.slice(cursor).match(/^([A-Z][a-z]?)(\d+(?:\.\d+)?)?/);
    if (!match || !ELEMENTS.has(match[1])) return null;
    parts.push({ element: match[1], number: match[2] || "" });
    cursor += match[0].length;
  }
  const hasNumber = parts.some(part => part.number);
  // A lone H2/O2-like token may also be a phase label (H1/H2/H3) in battery papers.
  // Keep it unchanged unless it carries an explicit ionic charge; multi-element formulas are unambiguous.
  if (!charge && (!hasNumber || parts.length < 2)) return null;
  return { parts, charge };
}

function formatToken(token) {
  const unit = token.match(/^((?:cm|mm|µm|μm|nm|kg|mg|µg|μg|mol|s|h|m|g))([−-]\d+)$/);
  if (unit) return [{ text: unit[1], script: "" }, { text: unit[2], script: "sup" }];
  const formula = parseFormula(token);
  if (!formula) return [{ text: token, script: "" }];
  const runs = [];
  for (const [index, part] of formula.parts.entries()) {
    pushRun(runs, part.element);
    if (!part.number) continue;
    const isChargeNumber = formula.charge && formula.parts.length === 1 && index === formula.parts.length - 1;
    pushRun(runs, part.number, isChargeNumber ? "sup" : "sub");
  }
  if (formula.charge) pushRun(runs, formula.charge, "sup");
  return runs;
}

export function scientificRuns(text) {
  const value = String(text || "");
  const runs = [];
  let cursor = 0;
  for (const match of value.matchAll(TOKEN_PATTERN)) {
    pushRun(runs, value.slice(cursor, match.index));
    for (const run of formatToken(match[0])) pushRun(runs, run.text, run.script);
    cursor = match.index + match[0].length;
  }
  pushRun(runs, value.slice(cursor));
  return runs;
}

export function renderScientificText(container, text) {
  container.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const run of scientificRuns(text)) {
    const node = run.script ? document.createElement(run.script) : document.createTextNode(run.text);
    if (run.script) node.textContent = run.text;
    fragment.append(node);
  }
  container.append(fragment);
}
