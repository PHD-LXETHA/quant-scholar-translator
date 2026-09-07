import assert from "node:assert/strict";
import test from "node:test";
import { buildOcrTextBlocks, buildTextBlocks, isFigureCaptionText, isTableCaptionText, sortBlocksForReading } from "../pdf-layout.mjs";

const viewport = { width: 600, height: 800, scale: 1, transform: [1, 0, 0, 1, 0, 0] };
const item = (str, x, baseline, width = 120, size = 10) => ({ str, width, height: size, transform: [size, 0, 0, size, x, baseline], hasEOL: true });

test("rebuilds OCR lines into positioned research paragraphs", () => {
  const blocks=buildOcrTextBlocks([
    {text:"Expected returns increase with systematic risk",x:50,y:100,width:250,height:12},
    {text:"under the capital asset pricing model.",x:50,y:114,width:210,height:12},
    {text:"A separate right column",x:330,y:100,width:180,height:12}
  ],viewport,600,800);
  assert.ok(blocks.some(block=>block.text.includes("systematic risk under the capital asset pricing model")));
  assert.ok(blocks.some(block=>block.text.includes("separate right column")));
});

test("keeps simultaneous left and right column lines separate", () => {
  const blocks = buildTextBlocks([
    item("Left column line one", 50, 100),
    item("Right column line one", 330, 100),
    item("Left column line two", 50, 114),
    item("Right column line two", 330, 114)
  ], viewport);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].text, /^Left column/);
  assert.match(blocks[1].text, /^Right column/);
  assert.ok(blocks.every(block => block.width < viewport.width / 2));
  assert.ok(blocks.every(block=>block.lines.every(line=>line.segments?.length)));
});

test("removes duplicate PDF text tokens drawn at the same position", () => {
  const duplicated = item("A duplicated scientific sentence about layered oxide cathodes", 50, 100, 360, 10);
  const blocks = buildTextBlocks([duplicated, { ...duplicated }], viewport);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, duplicated.str);
});

test("uses the font top rather than the baseline for overlay boxes", () => {
  const [block] = buildTextBlocks([item("A title", 50, 80, 250, 20)], viewport);
  assert.equal(block.y, 60);
  assert.ok(block.bottom > 80);
});

test("weights line font size by text width so scientific superscripts do not create captions", () => {
  const normal = { ...item("the ionic conductivity from 3.6 to 5.5 mS cm", 50, 100, 300, 10), hasEOL: false };
  const exponent = item("−1", 350, 100, 10, 6);
  const [block] = buildTextBlocks([normal, exponent], viewport);
  assert.equal(block.fontSize, 10);
  assert.equal(block.role, "body");
});

test("keeps a long first-page abstract and its short final line at body size", () => {
  const blocks = buildTextBlocks([
    item("A Wide Scientific Paper Title", 40, 60, 500, 20),
    item("with a second title line", 40, 84, 500, 20),
    item("Institute metadata and affiliation line one with several words", 50, 125, 500, 8),
    item("Institute metadata and affiliation line two with several words", 50, 136, 500, 8),
    item("ABSTRACT This long abstract sentence establishes the scientific context and main result", 50, 200, 500, 10),
    item("The abstract continues with experimental evidence and mechanistic interpretation", 50, 214, 500, 10),
    item("The final full-width abstract line ends without completing the conclusion", 50, 228, 500, 10),
    item("for practical applications.", 50, 242, 180, 10),
    item("Introduction", 50, 290, 120, 11),
    item("Left body line one with enough scientific prose", 50, 325, 220, 10),
    item("Left body line two continues the paragraph", 50, 339, 220, 10),
    item("Right body line one continues after the left column", 330, 325, 220, 10),
    item("Right body line two completes the discussion", 330, 339, 220, 10)
  ], viewport);
  const abstract = blocks.find(block => block.text.startsWith("ABSTRACT"));
  assert.equal(abstract.role, "body");
  assert.match(abstract.text, /for practical applications\.$/);
  assert.equal(blocks.find(block => block.text === "Introduction").role, "heading");
});

test("merges a wrapped compact title-style subsection heading", () => {
  const blocks = buildTextBlocks([
    item("Body paragraph line one establishes the normal font size", 50, 120, 220, 10),
    item("Body paragraph line two continues the scientific discussion", 50, 134, 220, 10),
    item("Interfacial Dynamics and in situ", 80, 220, 230, 11),
    item("Characterization", 50, 234, 125, 11),
    item("Subsequently the interfacial kinetics are systematically investigated", 50, 270, 300, 10),
    item("The paragraph continues with ionic conductivity measurements", 50, 284, 300, 10)
  ], viewport);
  const heading = blocks.find(block => block.role === "heading" && block.text.includes("Interfacial Dynamics"));
  assert.equal(heading.text, "Interfacial Dynamics and in situ Characterization");
  assert.equal(heading.headingLevel, 3);
});

test("classifies publisher edge notices and journal footers as page artifacts", () => {
  const blocks = buildTextBlocks([
    item("Downloaded from Wiley Online Library under the applicable Creative Commons License and terms-and-conditions.", 570, 20, 700, 8),
    item("A scientific body paragraph remains translatable content on the page.", 50, 200, 350, 10),
    item("3 of 12", 520, 770, 40, 10),
    item("Advanced Materials, 2026", 50, 772, 130, 9)
  ], viewport);
  assert.equal(blocks.filter(block => block.role === "artifact").length, 3);
  assert.equal(blocks.find(block => block.text.startsWith("A scientific")).role, "body");
});

test("merges consecutive large title lines into one translation block", () => {
  const blocks = buildTextBlocks([
    item("First title line", 50, 80, 420, 22),
    item("Second title line", 50, 108, 360, 22),
    item("Body paragraph line one", 50, 160, 220, 10),
    item("Body paragraph line two", 50, 174, 220, 10)
  ], viewport);
  assert.equal(blocks.filter(block => block.role === "heading").length, 1);
  assert.match(blocks.find(block => block.role === "heading").text, /First title line Second title line/);
  assert.equal(blocks.find(block => block.role === "heading").headingLevel, 1);
});

test("keeps paper titles and section headings in separate hierarchy levels", () => {
  const blocks = buildTextBlocks([
    item("Paper title", 50, 70, 420, 22),
    item("1. Introduction", 50, 130, 240, 15),
    item("Body paragraph line one", 50, 180, 220, 10),
    item("Body paragraph line two", 50, 194, 220, 10)
  ], viewport);
  assert.equal(blocks.find(block => block.text === "Paper title").headingLevel, 1);
  assert.equal(blocks.find(block => block.text === "1. Introduction").headingLevel, 2);
});

test("recognizes same-size numbered SI and subsection headings semantically", () => {
  const blocks=buildTextBlocks([
    item("3.2. Electrochemical Performance",50,100,280,10),
    item("The cycling performance was evaluated after fabrication.",50,140,430,10),
    item("S1. Experimental Procedures",50,190,260,10)
  ],viewport);
  assert.equal(blocks.find(block=>block.text.startsWith("3.2")).role,"heading");
  assert.equal(blocks.find(block=>block.text.startsWith("3.2")).headingLevel,3);
  assert.equal(blocks.find(block=>block.text.startsWith("S1")).role,"heading");
  assert.equal(blocks.find(block=>block.text.startsWith("S1")).headingLevel,2);
});

test("keeps isolated numbered references at body size even when their PDF font is large", () => {
  const blocks=buildTextBlocks([
    item("A normal reference-list continuation establishes the body font size",50,100,430,10),
    item("and continues on a second line without becoming a heading.",50,114,360,10),
    item("23. L. Li, J. L. Shen, H. Yang, et al., Advanced Energy Materials 14 (2024): e202400001.",50,180,500,14),
    item("38. W",50,230,55,14)
  ],viewport);
  for(const text of ["23. L. Li","38. W"]){
    const reference=blocks.find(block=>block.text.startsWith(text));
    assert.equal(reference.role,"body");
    assert.equal(reference.headingLevel,0);
  }
});

test("classifies compact author metadata below the paper title separately from body text", () => {
  const blocks = buildTextBlocks([
    item("Paper title", 50, 70, 420, 22),
    item("Alice Researcher and Bob Scientist", 50, 105, 300, 11),
    item("Abstract paragraph line one", 50, 180, 420, 10),
    item("Abstract paragraph line two", 50, 194, 420, 10),
    item("Abstract paragraph line three", 50, 208, 420, 10)
  ], viewport);
  assert.equal(blocks.find(block => block.text.startsWith("Alice")).role, "metadata");
  assert.equal(blocks.find(block => block.text.startsWith("Abstract")).role, "body");
});

test("classifies figure captions separately from small footnotes", () => {
  const blocks = buildTextBlocks([
    item("Body paragraph line one", 50, 100, 220, 10),
    item("Body paragraph line two", 50, 114, 220, 10),
    item("Figure 2. Structural characterization results", 50, 300, 420, 8)
  ], viewport);
  assert.equal(blocks.find(block => block.text.startsWith("Figure 2")).role, "figure-caption");
});

test("recognizes supporting-information figure and table numbering", () => {
  for (const caption of ["Figure S1: XRD patterns", "Fig. S12a. SEM image", "图S8：循环后形貌", "Table S 3. Refinement data", "Supporting Figure 4. Control experiment"]) {
    assert.equal(isFigureCaptionText(caption), true, caption);
  }
  assert.equal(isFigureCaptionText("Figure-flow validation title"), false);
  assert.equal(isTableCaptionText("TABLE 2 | Photovoltaic parameters of champion PSCs"), true);
  assert.equal(isTableCaptionText("Figure 2. Cycling performance"), false);
});

test("does not merge table column headers into the translated table caption", () => {
  const cell = (str, x, baseline, width = 70, size = 8, hasEOL = false) => ({ str, width, height: size, transform: [size, 0, 0, size, x, baseline], hasEOL });
  const blocks = buildTextBlocks([
    cell("TABLE 2 | Photovoltaic parameters of champion PSCs", 50, 300, 430, 8, true),
    cell("Jsc (mA cm-2)", 65, 325), cell("Voc (V)", 190, 325), cell("FF (%)", 300, 325), cell("PCE (%)", 400, 325, 70, 8, true),
    cell("4PACz-F", 65, 345), cell("24.60", 190, 345), cell("1.169", 300, 345), cell("21.53", 400, 345, 70, 8, true)
  ], viewport);
  const caption = blocks.find(block => block.role === "figure-caption");
  assert.ok(caption);
  assert.match(caption.text, /^TABLE 2/);
  assert.ok(!caption.text.includes("Jsc"));
  assert.ok(blocks.some(block => block.text.includes("Jsc")));
});

test("merges a multi-line Figure S caption without absorbing following SI text", () => {
  const blocks = buildTextBlocks([
    item("Figure S8:", 50, 400, 72, 8),
    item("SEM images of cycled PC-SNMO particles.", 130, 400, 310, 8),
    item("(a) Overview. (b) Magnified FIB-SEM image.", 50, 411, 390, 8),
    item("(c) Cross-sectional morphology after cycling.", 50, 422, 390, 8),
    item("Additional discussion line one", 50, 460, 220, 10),
    item("Additional discussion line two", 50, 474, 220, 10),
    item("Additional discussion line three", 50, 488, 220, 10)
  ], viewport);
  const captions=blocks.filter(block=>block.role==="figure-caption");
  assert.equal(captions.length,1);
  assert.match(captions[0].text,/Figure S8: SEM images/);
  assert.match(captions[0].text,/Cross-sectional morphology/);
  assert.ok(!captions[0].text.includes("Additional discussion"));
});

test("merges widely spaced multi-panel SI caption continuations into one block", () => {
  const blocks=buildTextBlocks([
    item("Figure S11: (a-b) Nyquist plots of symmetric cells built with",50,300,460,8),
    item("pristine (not pre-cycled) electrodes and a non-intercalating electrolyte",50,323,470,8),
    item("PC/EMC).",50,346,110,8),
    item("(c-d) Nyquist plots of the 1st and 40th cycles of symmetric cells",50,369,470,8),
    item("with equivalent circuit calculated values at different magnifications",50,392,465,8),
    item("to emphasize low and high frequency behavior.",50,415,350,8),
    item("The following discussion belongs to the SI body and not the caption.",50,470,440,10),
    item("It must remain an independent paragraph after the figure.",50,484,390,10)
  ],viewport);
  const captions=blocks.filter(block=>block.role==="figure-caption");
  assert.equal(captions.length,1);
  assert.match(captions[0].text,/\(c-d\) Nyquist plots/);
  assert.match(captions[0].text,/low and high frequency behavior/);
  assert.ok(!captions[0].text.includes("following discussion"));
  assert.ok(blocks.some(block=>block.text.includes("following discussion")&&block.role==="body"));
});

test("merges split figure-caption fragments and continuation lines before translation", () => {
  const blocks = buildTextBlocks([
    item("Body paragraph line one", 50, 220, 220, 10),
    item("Body paragraph line two", 50, 234, 220, 10),
    item("Body paragraph line three", 50, 248, 220, 10),
    item("Figure 3.", 50, 400, 70, 8),
    item("Electrochemical performance under practical conditions.", 130, 400, 360, 8),
    item("(a) Cycling curves. (b) Rate capability and retention.", 50, 411, 440, 8),
    item("Following discussion line one", 50, 450, 220, 10),
    item("Following discussion line two", 50, 464, 220, 10),
    item("Following discussion line three", 50, 478, 220, 10)
  ], viewport);
  const captions = blocks.filter(block => block.role === "figure-caption");
  assert.equal(captions.length, 1);
  assert.match(captions[0].text, /Figure 3\. Electrochemical performance/);
  assert.match(captions[0].text, /Cycling curves/);
  assert.ok(!captions[0].text.includes("Following discussion"));
});

test("merges a Wiley FIGURE label with its overlapping multi-line panel caption", () => {
  const wideViewport = { width: 980, height: 1231.7, scale: 1, transform: [1, 0, 0, 1, 0, 0] };
  const wideItem = (str, x, baseline, width, size = 8.3, hasEOL = true) => ({
    str, width, height: size, transform: [size, 0, 0, size, x, baseline], hasEOL
  });
  const blocks = buildTextBlocks([
    wideItem("The preceding scientific discussion establishes the normal body font size for this journal page.", 83.1, 580, 390, 10),
    wideItem("The paragraph continues with electrochemical evidence and a sufficiently long narrative sentence.", 83.1, 594, 390, 10),
    wideItem("Additional body text remains separate from the figure caption and is translated normally.", 510, 580, 390, 10),
    wideItem("This right-column paragraph supplies another normal-sized multiline body block for classification.", 510, 594, 390, 10),
    wideItem("FIGURE 4", 83.1, 697.0, 64.8, 8.3),
    wideItem("(a) The CV curves at a scan rate of 0.5 mV s-1. (b) Rate capability test of all samples.", 169.0, 697.0, 696.2, 8.3),
    wideItem("(c) Comparison of rate capability at various current densities. (d) Cycling stability at 0.5 A g-1.", 83.1, 708.8, 782.1, 8.3),
    wideItem("(e) Long cycling stability at a high current density. (f) Comparison with previously reported materials.", 83.1, 720.6, 782.1, 8.3),
    wideItem("(g) Schematic illustration of the full cell. (h) Charge and discharge curves of the first cycle.", 83.1, 732.4, 782.1, 8.3),
    wideItem("(i) CV curves at different scan rates. (j-k) Rate capability and cycling stability results.", 83.1, 744.2, 782.1, 8.3)
  ], wideViewport);
  const captions = blocks.filter(block => block.role === "figure-caption");
  assert.equal(captions.length, 1);
  assert.match(captions[0].text, /^FIGURE 4 \(a\) The CV curves/);
  assert.match(captions[0].text, /\(j-k\) Rate capability/);
  assert.ok(captions[0].width > wideViewport.width * .75);
});

test("merges a bare Wiley FIGURE label with a long same-row descriptive caption", () => {
  const journalViewport = { width: 949.04, height: 1239.02, scale: 1, transform: [1, 0, 0, 1, 0, 0] };
  const journalItem = (str, x, baseline, width, size = 12.35, hasEOL = true) => ({
    str, width, height: size, transform: [size, 0, 0, size, x, baseline], hasEOL
  });
  const blocks = buildTextBlocks([
    journalItem("FIGURE 2", 83.1, 663.3, 64),
    journalItem("Electrochemical characteristics of RNFS and NFS electrodes. CV curves of both electrodes for the first two cycles.", 169.2, 663.3, 696),
    journalItem("(c) Rate performance. (d) Cycling performance at 1C. (e) Long-term cycling performance at 20C.", 83.1, 681.1, 782.1),
    journalItem("The inset shows GCD curves and SEM images after 2000 cycles. (f) Radar plot comparison.", 83.1, 698.9, 782.1),
    journalItem("(g) Diffusion-controlled contribution ratios at different scan rates. (h) GITT curves.", 83.1, 716.7, 782.1),
    journalItem("Corresponding sodium-ion diffusion coefficients during charge-discharge cycling.", 83.1, 734.5, 650),
    journalItem("The following scientific discussion is normal body text in the left column.", 83.1, 790, 377.9, 13.9),
    journalItem("It continues on another line and must remain outside the figure caption.", 83.1, 807.8, 377.9, 13.9)
  ], journalViewport);
  const captions = blocks.filter(block => block.role === "figure-caption");
  assert.equal(captions.length, 1);
  assert.match(captions[0].text, /^FIGURE 2 Electrochemical characteristics/);
  assert.match(captions[0].text, /diffusion coefficients/);
  assert.ok(captions[0].width > journalViewport.width * .8);
  assert.ok(!captions[0].text.includes("following scientific discussion"));
});

test("orders a two-column page as header, left column, then right column", () => {
  const blocks = buildTextBlocks([
    item("Wide paper title", 40, 60, 500, 20),
    item("Left paragraph", 50, 130),
    item("Right paragraph", 330, 120)
  ], viewport);
  const ordered = sortBlocksForReading(blocks, viewport);
  assert.equal(ordered[0].text, "Wide paper title");
  assert.equal(ordered[1].text, "Left paragraph");
  assert.equal(ordered[2].text, "Right paragraph");
});

test("orders first-page blocks by visual position for title, authors and abstract", () => {
  const blocks = buildTextBlocks([
    item("Wide paper title", 40, 60, 500, 20),
    item("Left metadata", 50, 130),
    item("Authors", 330, 120),
    item("Abstract paragraph", 330, 150)
  ], viewport);
  const ordered = sortBlocksForReading(blocks, viewport, 1);
  assert.deepEqual(ordered.map(block => block.text), ["Wide paper title", "Authors", "Left metadata", "Abstract paragraph"]);
});

test("orders columns below a first-page Introduction heading from left to right", () => {
  const blocks = [
    { text: "Paper title", role: "heading", headingLevel: 1, x: 40, right: 560, width: 520, y: 60, bottom: 90, fontSize: 20 },
    { text: "Introduction", role: "heading", headingLevel: 2, x: 50, right: 170, width: 120, y: 500, bottom: 520, fontSize: 14 },
    { text: "right continuation", role: "body", x: 330, right: 550, width: 220, y: 521, bottom: 580, fontSize: 10 },
    { text: "left paragraph start", role: "body", x: 50, right: 270, width: 220, y: 535, bottom: 590, fontSize: 10 }
  ];
  const ordered = sortBlocksForReading(blocks, viewport, 1);
  assert.deepEqual(ordered.map(block => block.text), ["Paper title", "Introduction", "left paragraph start", "right continuation"]);
});
