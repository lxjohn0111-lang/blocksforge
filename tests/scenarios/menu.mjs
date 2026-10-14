export default async function (page, h) {
  await h.waitFor(() => window.__bf && window.__bf.state === 'menu');
  console.log('booted');
  await h.run(3000);
  await h.shot('menu');
}
