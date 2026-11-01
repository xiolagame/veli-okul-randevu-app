// Remote revocation is best-effort offline, but can never hold local credentials open.
export async function revokeSessionWithinBudget(revoke:(signal:AbortSignal)=>Promise<unknown>, timeoutMs=1500):Promise<boolean> {
  const controller=new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(()=>revoke(controller.signal)).then(()=>true,()=>false),
      new Promise<boolean>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(false);},timeoutMs);}),
    ]);
  }finally{if(timer!==undefined)clearTimeout(timer);}
}
