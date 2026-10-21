// A queued Telegram update is complete only after its user-visible handler
// succeeds. Transient callback exceptions must propagate to the durable
// Telegram update queue instead of being silently acknowledged as processed.
export async function dispatchTelegramUpdate(update,{sql,onMessage,onSourcePost,onCallback,acknowledge,log=console}){
 const id=update?.update_id;
 if(!Number.isSafeInteger(id)||id<0)throw Error("Invalid Telegram update id");
 const completed=await sql("SELECT id FROM mm_updates WHERE id=$1",id);
 if(completed.length)return {duplicate:true};
 if(update.callback_query?.id){
  try{await acknowledge(update.callback_query.id)}
  catch(error){log.warn("Callback acknowledgement failed",String(error))}
 }
 if(update.message&&(update.message.from||update.message.chat?.type!=="private")){
  await onMessage(update.message);
 }
 if(update.channel_post)await onSourcePost(update.channel_post);
 if(update.callback_query?.from){
  try{await onCallback(update.callback_query)}
  catch(error){
   log.error("Callback action failed",JSON.stringify({
    updateId:id,
    action:String(update.callback_query.data||"").slice(0,100),
    error:String(error)
   }));
   // Do not write mm_updates: let the existing persistent queue retry.
   throw error;
  }
 }
 await sql("INSERT INTO mm_updates(id) VALUES($1) ON CONFLICT DO NOTHING",id);
 return {duplicate:false};
}
