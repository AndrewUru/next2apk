export default function Page() {
  async function submit() { 'use server'; console.log('server'); }
  return <form action={submit}><button>Submit</button></form>;
}
