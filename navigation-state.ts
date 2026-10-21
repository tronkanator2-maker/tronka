// Navigation must end the active text-input state when a user returns home.
// Wizard and confirmation states are intentionally excluded: Home offers Resume.
// The saved confirmation must stay active so Publish/Save still works after /start.
export const HOME_EXIT_STATES=new Set([
 "support","relay","reply_compose","browse_city","filter","photo",
 "profile","job","job_edit","delete_confirm"
]);
export function leavingToHome(user){
 if(!HOME_EXIT_STATES.has(user?.state))return null;
 const filters={...(user.filters||{})};
 delete filters.reportTarget;
 delete filters.relayPeer;
 delete filters.replyJobId;
 return {state:"",filters};
}
