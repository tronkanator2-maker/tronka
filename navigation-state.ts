// Navigation must end the active text-input state when a user returns home.
// Wizard states are intentionally excluded: the main menu offers Resume for them.
export const HOME_EXIT_STATES=new Set([
 "support","relay","reply_compose","browse_city","filter","photo",
 "profile","profile_confirm","job","job_confirm","job_edit",
 "job_edit_confirm","delete_confirm"
]);
export function leavingToHome(user){
 if(!HOME_EXIT_STATES.has(user?.state))return null;
 const filters={...(user.filters||{})};
 delete filters.reportTarget;
 delete filters.relayPeer;
 delete filters.replyJobId;
 return {state:"",filters};
}
