// Keep the latest in-progress screen on top of any older saved draft.
// This is a pure presentation helper; it must never mutate user data.
export function resumeMenu(user){
 const u=user||{},state=String(u.state||""),f=u.filters||{};
 const result=(label,rows)=>({label,rows});
 if(state==="job_wizard")return result("У вас есть незавершённая заявка.",[
  [{text:"▶️ Продолжить заявку",callback_data:"jobwizard:resume"},{text:"❌ Отменить",callback_data:"jobwizard:cancel"}]
 ]);
 if(state==="job_confirm"&&f.draft)return result("У вас есть заявка, ожидающая подтверждения.",[
  [{text:"✅ Опубликовать заявку",callback_data:"publish"},{text:"✏️ Исправить",callback_data:"job_template"}]
 ]);
 const editId=Number(f.draftJobId);
 if((state==="job_edit"||state==="job_edit_confirm")&&Number.isSafeInteger(editId)&&editId>0){
  return result("Вы редактировали заявку.",[
   [{text:state==="job_edit_confirm"?"✅ Сохранить изменения":"✏️ Вернуться к редактированию",callback_data:(state==="job_edit_confirm"?"updatejob:":"jobedit:")+editId},
    {text:"📌 Мои заявки",callback_data:"mine"}]
  ]);
 }
 if(state==="wizard")return result("У вас есть незавершённая анкета.",[
  [{text:"▶️ Продолжить анкету",callback_data:"wizard:resume"},{text:"❌ Отменить",callback_data:"wizard:cancel"}]
 ]);
 if(state==="profile_confirm"&&f.profileDraft)return result("Анкета ожидает подтверждения.",[
  [{text:"✅ Сохранить черновик",callback_data:"profile_save"},{text:"✏️ Исправить",callback_data:"edit_profile"}]
 ]);
 if(state==="photo")return result("Вы добавляли фотографии анкеты.",[
  [{text:"📷 Продолжить добавление",callback_data:"addphoto"},{text:"✅ Готово",callback_data:"photo_done"}]
 ]);
 if(state==="profile"||f.profileDraft)return result("У вас есть черновик анкеты.",[
  [{text:"📝 Вернуться к черновику",callback_data:"edit_profile"},{text:"❌ Отменить",callback_data:"wizard:cancel"}]
 ]);
 return result("",[]);
}
