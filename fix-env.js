const https = require('https');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const keyFile = 'C:/Users/anasr/Downloads/bonvoy-d2b12-firebase-adminsdk-fbsvc-f9dd8ca749.json';
let privateKey;
try { privateKey = require(keyFile).private_key; console.log('Key loaded, length:', privateKey.length); }
catch (e) { console.error('Could not load key:', e.message); process.exit(1); }
const siteId = '9e65b9d3-d0bf-48b1-bb29-ca7f334511a1';
function apiRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = { hostname: 'api.netlify.com', path, method, headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
async function run(token) {
  let res = await apiRequest('PATCH', `/api/v1/sites/${siteId}/env/FIREBASE_PRIVATE_KEY`, token, { value: privateKey, context: 'all' });
  console.log('PATCH status:', res.status);
  if (res.status === 200 || res.status === 201) { console.log('SUCCESS!'); return; }
  res = await apiRequest('DELETE', `/api/v1/sites/${siteId}/env/FIREBASE_PRIVATE_KEY`, token, null);
  console.log('DELETE status:', res.status);
  res = await apiRequest('POST', `/api/v1/sites/${siteId}/env`, token, [{ key: 'FIREBASE_PRIVATE_KEY', scopes: ['functions','runtime'], values: [{ value: privateKey, context: 'all' }] }]);
  console.log('POST status:', res.status, res.body.substring(0, 200));
}
rl.question('Paste Netlify token: ', (token) => { rl.close(); run(token.trim()).catch(console.error); });
