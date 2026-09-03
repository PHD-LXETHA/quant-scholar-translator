const HEADING=/^\s*(参考文献|References|Bibliography)\s*[:：]?\s*/i;
const MARKER=/(^|\s)(?:\[(\d{1,3})\]|\((\d{1,3})\)|(\d{1,3})[.)])(?=\s+(?:[A-Z\u4e00-\u9fff“"']))/g;

export function isReferenceEntryStart(text){
  const match=String(text||"").trim().match(/^(?:\[(\d{1,3})\]|\((\d{1,3})\)|(\d{1,3})[.)])\s+([\s\S]+)$/);
  if(!match)return false;
  const number=Number(match[1]||match[2]||match[3]);
  const content=match[4].trim();
  // Some PDFs isolate a high-numbered reference marker and the first author
  // initial (for example "38. W") in a separate, oversized text block.
  if(number>=10&&/^[B-HJ-Z]\.?$/.test(content))return true;
  const initialThenSurname=/^(?:[A-Z]\.\s*){1,3}[A-Z][A-Za-z'’\-]{1,}(?:\s*,|\s+(?:and|et\s+al\.?|等)\b)/i;
  const surnameThenInitial=/^[A-Z][A-Za-z'’\-]{1,},\s*(?:[A-Z]\.\s*){1,3}/;
  if(initialThenSurname.test(content)||surnameThenInitial.test(content))return true;
  const citationSignals=[
    /\b(?:19|20)\d{2}\b/.test(content),
    /(?:https?:\/\/|doi(?:\.org)?\s*[:/])/i.test(content),
    /\b(?:journal|materials?|chem(?:istry)?|energy|science|nature|advanced|angewandte|electrochimica|vol\.?|pp?\.)\b/i.test(content)
  ].filter(Boolean).length;
  return citationSignals>=2&&/[,;]/.test(content);
}

export function parseReferenceList(text,sourceText=""){
  const value=String(text||"");
  const headingMatch=value.match(HEADING);
  const sourceHasHeading=HEADING.test(String(sourceText||""));
  const markers=[]; let match;
  MARKER.lastIndex=0;
  while((match=MARKER.exec(value))){
    const number=Number(match[2]||match[3]||match[4]);
    const markerStart=match.index+match[1].length;
    markers.push({number,markerStart,contentStart:MARKER.lastIndex});
  }
  if(markers.length<2)return null;
  const entries=markers.map((marker,index)=>{
    const end=index+1<markers.length?markers[index+1].markerStart:value.length;
    return {number:marker.number,text:value.slice(marker.contentStart,end).trim(),start:marker.markerStart,end};
  }).filter(entry=>entry.text);
  if(entries.length<2)return null;
  const sequential=entries.slice(1).filter((entry,index)=>entry.number===entries[index].number+1).length;
  if(!headingMatch&&!sourceHasHeading){
    const sequentialList=entries.length>=3&&sequential>=Math.ceil((entries.length-1)*.6);
    const verifiedPair=entries.length===2&&sequential===1
      &&entries.every(entry=>isReferenceEntryStart(`${entry.number}. ${entry.text}`));
    if(!sequentialList&&!verifiedPair)return null;
  }
  const heading=headingMatch?.[1]||"";
  const leadStart=headingMatch?.[0].length||0;
  const lead=value.slice(leadStart,markers[0].markerStart).trim();
  return {heading,lead,leadStart,leadEnd:markers[0].markerStart,entries};
}
