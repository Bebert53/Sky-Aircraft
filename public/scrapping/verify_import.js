const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'traffic.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('DB error:', err.message);
    process.exit(1);
  }

  db.get('SELECT COUNT(*) as cnt FROM aircraft_types', (err, row) => {
    if (err) {
      console.error('Query error:', err.message);
      db.close();
      process.exit(1);
    }
    
    const count = row.cnt;
    console.log(`Aircraft records in DB: ${count}`);
    
    if (count > 0) {
      db.all('SELECT icao24, registration, manufacturer, model FROM aircraft_types LIMIT 5', (err, rows) => {
        if (err) {
          console.error('Sample error:', err.message);
        } else {
          console.log('\nSample data:');
          console.table(rows);
        }
        db.close();
        process.exit(0);
      });
    } else {
      console.warn('No records found!');
      db.close();
      process.exit(1);
    }
  });
});
