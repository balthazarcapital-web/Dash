// Uso: node scripts/import-climate.mjs caminho.xlsx clientId
// Atualizações substituem somente as datas presentes no novo arquivo.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import XLSX from 'xlsx';

export const fields=['tavg','tmin','tmax','prcp','snow','wdir','wspd','wpgt','pres','tsun'];
export function normalizeRows(rows){
  if(!rows.length || !('date' in rows[0]) || !fields.some(key=>key in rows[0])) throw new Error('Arquivo sem as colunas date e dados climáticos reconhecidos.');
  const dates=new Set();
  return rows.map((row,index)=>{
    const date=row.date instanceof Date?row.date.toISOString().slice(0,10):String(row.date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) throw new Error(`Data inválida na linha ${index+2}.`);
    if(dates.has(date)) throw new Error(`Data duplicada no arquivo: ${date}.`);
    dates.add(date);
    const result={date};
    for(const field of fields){
      const raw=row[field];
      if(raw==null||String(raw).trim()===''||raw==='M'){result[field]=null;continue;}
      const value=Number(raw);
      if(!Number.isFinite(value)) throw new Error(`Valor inválido em ${field}, ${date}.`);
      result[field]=value;
    }
    return result;
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function mergeRows(previous,incoming){
  const byDate=new Map(previous.map(row=>[row.date,row]));
  incoming.forEach(row=>byDate.set(row.date,row));
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
const hourlyFields={tavg:'Temp. Ins. (C)',tmin:'Temp. Min. (C)',tmax:'Temp. Max. (C)',prcp:'Chuva (mm)',wspd:'Vel. Vento (m/s)',wpgt:'Raj. Vento (m/s)',humidity:'Umi. Ins. (%)',pres:'Pressao Ins. (hPa)'};
export function normalizeHourlyRows(rows){
  const seen=new Set();
  if(!rows.length||!Object.values(hourlyFields).every(key=>key in rows[0]))throw new Error('Colunas horárias incompletas.');
  return rows.map(row=>{
    const parts=String(row.Data).match(/^(\d{2})\/(\d{2})\/(\d{4})$/),hour=String(row['Hora (UTC)']).padStart(4,'0');
    const date=parts?`${parts[3]}-${parts[2]}-${parts[1]}`:'';
    if(!date||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!/^([01]\d|2[0-3])00$/.test(hour))throw new Error('Data/hora inválida no CSV.');
    const timestamp=date+'T'+hour.slice(0,2)+':00:00Z';
    if(seen.has(timestamp))throw new Error('Hora duplicada: '+timestamp);
    seen.add(timestamp);
    const result={timestamp};
    for(const [field,key] of Object.entries(hourlyFields)){
      const raw=row[key],value=raw==null||String(raw).trim()===''?null:Number(String(raw).replace(',','.'));
      if(value!==null&&!Number.isFinite(value))throw new Error('Valor inválido: '+key);
      result[field]=value===-9999?null:value;
      if(result[field]!==null&&(['prcp','wspd','wpgt','humidity'].includes(field)&&result[field]<0||field==='humidity'&&result[field]>100))throw new Error('Valor fora da faixa: '+key);
    }
    return result;
  });
}
export function mergeHours(previous,incoming){
  const map=new Map(previous.map(row=>[row.timestamp,row]));
  for(const row of incoming){
    const merged={...map.get(row.timestamp),timestamp:row.timestamp};
    for(const field of Object.keys(hourlyFields))merged[field]=row[field]??merged[field]??null;
    map.set(row.timestamp,merged);
  }
  return [...map.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
}
export function aggregateHours(hours){
  const groups=new Map();
  for(const row of hours){const date=row.timestamp.slice(0,10);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(row);}
  return [...groups].sort().flatMap(([date,rows])=>{
    const values=key=>rows.map(row=>row[key]).filter(value=>value!==null&&value!==undefined);
    if(!Object.keys(hourlyFields).some(key=>values(key).length))return [];
    const result={date,timeBasis:'UTC',windUnit:'m/s',rainUnit:'mm',rainHours:values('prcp').length,tempHours:values('tavg').length};
    for(const key of Object.keys(hourlyFields)){
      const v=values(key);
      result[key]=!v.length?null:key==='tmin'?Math.min(...v):['tmax','wpgt'].includes(key)?Math.max(...v):v.reduce((s,n)=>s+n,0)/(key==='prcp'?1:v.length);
      if(result[key]!==null)result[key]=Math.round(result[key]*100)/100;
    }
    return [result];
  });
}
// Rain and hourly extrema use the preceding-hour interval convention.
// Instantaneous samples include both 08:00 and 17:00; accumulated intervals are 08–09 ... 16–17.
export function aggregateBusinessHours(hours){
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  const grouped=new Map();
  for(const row of mergeHours([],hours)){
    const parts=Object.fromEntries(formatter.formatToParts(new Date(row.timestamp)).map(p=>[p.type,p.value]));
    const date=`${parts.year}-${parts.month}-${parts.day}`,hour=Number(parts.hour);
    if(hour<8||hour>17)continue;
    const sample={...row,timestamp:date+'T'+String(hour).padStart(2,'0')+':00:00Z'};
    if(hour===8)for(const key of ['prcp','tmin','tmax','wpgt'])sample[key]=null;
    if(!grouped.has(date))grouped.set(date,[]);
    grouped.get(date).push(sample);
  }
  return aggregateHours([...grouped.values()].flat()).map(row=>({...row,timeBasis:'America/Sao_Paulo',period:'08:00–17:00',expectedRainHours:9,expectedTempSamples:10}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [filename,clientId]=process.argv.slice(2);
  if(!filename||!clientId) throw new Error('Informe arquivo e clientId explicitamente.');
  const root=path.resolve(import.meta.dirname,'..');
  const workbook=XLSX.readFile(filename,{cellDates:true,raw:path.extname(filename).toLowerCase()==='.csv'});
  const records=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{defval:null});
  const target=path.join(root,'climate-data.json');
  const database=JSON.parse(await fs.readFile(target,'utf8'));
  const entry=database.find(row=>row.clientId===clientId);
  if(!entry) throw new Error('Cliente sem base climática cadastrada; não será associada a outra obra.');
  const hourly=records[0]&&'Hora (UTC)' in records[0];
  let incoming;
  if(hourly){
    entry.hours=mergeHours(entry.hours||[],normalizeHourlyRows(records));
    incoming=aggregateHours(entry.hours).map(row=>({...row,source:path.basename(filename)}));
    entry.businessRows=aggregateBusinessHours(entry.hours).map(row=>({...row,source:path.basename(filename)}));
    entry.stationVerified=false;
  }else incoming=normalizeRows(records);
  entry.rows=mergeRows(entry.rows,incoming);
  entry.source=path.basename(filename);
  const json=JSON.stringify(database,null,2);
  await fs.writeFile(target,json+'\n');
  await fs.writeFile(path.join(root,'climate-data.js'),'// Gerado por scripts/import-climate.mjs. Não editar manualmente.\nwindow.AbsoluttaClimateData = '+json+';\n');
  console.log(`${incoming.length} dias importados. Base: ${entry.rows[0].date} a ${entry.rows.at(-1).date} (${entry.rows.length} dias).`);
}
