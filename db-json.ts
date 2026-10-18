const JSON_COLUMNS=["consent","profile","filters","photos","payload","details","document_versions","document_hashes"];

export function decodeDbRows(rows,query=""){
 const fields=/\bmm_jobs\b/i.test(query)?[...JSON_COLUMNS,"body"]:JSON_COLUMNS;
 return rows.map(row=>{
  if(!row||typeof row!=="object")return row;
  const result={...row};
  for(const field of fields){
   if(typeof result[field]!=="string")continue;
   const value=result[field].trim();
   if(!value.startsWith("{")&&!value.startsWith("["))continue;
   result[field]=JSON.parse(value);
  }
  return result;
 });
}
