import { action } from './app/routes/api-storage-list.ts';

const req = new Request('http://localhost/api/storage/list', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    bucket: 'NETCOOKIES',
    path: ''
  })
});

const res = await action({ request: req });

console.log('status:', res.status);
console.log(await res.text());