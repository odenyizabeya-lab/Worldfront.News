const db = require('./server/db');
db.ready().then(() => {
  const a = db.all("SELECT id,title,image,summary,source_name,status,link FROM articles LIMIT 12");
  a.forEach(x => {
    console.log('id=' + x.id + ' img=' + (x.image ? 'YES:' + String(x.image).slice(0,60) : 'NO') + ' | ' + String(x.title).slice(0,45));
  });
  console.log('total rows:', db.get('SELECT COUNT(*) c FROM articles').c);
  db.persist();
}).catch(e => { console.error(e); process.exit(1); });
