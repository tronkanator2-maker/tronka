// Profile editor drafts must not modify public profiles before explicit confirmation.
export function profileDraftOf(user){
 const candidate=user?.filters?.profileDraft;
 return candidate&&typeof candidate==="object"&&!Array.isArray(candidate)?{...candidate}:{...(user?.profile||{})};
}
export function stageProfileDraft(filters,profile,extra={}){
 return {...(filters||{}),profileDraft:{...(profile||{})},...extra};
}
export function discardProfileDraft(filters){
 const result={...(filters||{})};
 for(const key of ["profileDraft","profileDraftPhoto","wizardRole","wizardStep"])delete result[key];
 return result;
}
export function mergeProfilePhoto(photos,photo){
 const result=[...new Set([...(Array.isArray(photos)?photos:[]),...(photo?[photo]:[])])];
 return result.slice(0,5);
}
