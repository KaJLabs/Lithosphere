const positivePort=(value,name)=>{
 const parsed=Number(value);
 if(!Number.isInteger(parsed)||parsed<1||parsed>65535)throw Error(`invalid ${name}`);
 return parsed;
};
export const reviewPostgres=()=>({
 host:process.env.MULTX_REVIEW_PG_HOST||'127.0.0.1',
 port:positivePort(process.env.MULTX_REVIEW_PG_PORT||'55441','review PostgreSQL port'),
 user:process.env.MULTX_REVIEW_PG_USER||process.env.USER||process.env.USERNAME,
 database:process.env.MULTX_REVIEW_PG_DATABASE||'postgres',
});
const loopbackRpc=(name,fallback)=>{
 const url=new URL(process.env[name]||fallback);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error(`invalid ${name}`);
 return url.href;
};
export const reviewSourceRpc=()=>loopbackRpc('MULTX_REVIEW_SOURCE_RPC','http://127.0.0.1:18547');
export const reviewDestinationRpc=()=>loopbackRpc('MULTX_REVIEW_DESTINATION_RPC','http://127.0.0.1:18546');
