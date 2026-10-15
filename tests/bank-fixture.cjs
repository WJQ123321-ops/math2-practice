// Isolated fictional fixture: unit tests must not depend on an importer's real bank.
const bank=require('./fixtures/bank.json');
for(const file of ['../private/data/bank.json','../functions/math2-api/assets/data/bank.json']){const id=require.resolve(file);require.cache[id]={id,filename:id,loaded:true,exports:bank};}
const history=require.resolve('../functions/math2-api/goal-bank-history.json');require.cache[history]={id:history,filename:history,loaded:true,exports:[]};
