const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const dummyFile = path.join(process.cwd(), 'dummy_to_delete.txt');
  fs.writeFileSync(dummyFile, 'hello trash');
  try {
    await shell.trashItem(dummyFile);
    console.log('Trashed successfully. Check your trash bin.');
  } catch (err) {
    console.error('Error trashing:', err);
  }
  app.quit();
});
