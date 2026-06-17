const keytar = require('keytar');

(async () => {
  try {
    const creds = await keytar.findCredentials('Vercel CLI');
    for (const c of creds) {
      console.log('ACCOUNT:', c.account);
      console.log('PASSWORD:', c.password);
      console.log('---');
    }
    if (creds.length === 0) {
      // Try alternative service names
      const services = ['vercel', 'Vercel', 'vercel-cli', 'Vercel CLI'];
      for (const s of services) {
        const c2 = await keytar.findCredentials(s);
        if (c2.length > 0) {
          console.log('FOUND in service:', s);
          for (const c of c2) {
            console.log('ACCOUNT:', c.account);
            console.log('PASSWORD:', c.password);
          }
        }
      }
    }
  } catch (e) {
    console.log('ERROR:', e.message);
  }
})();
