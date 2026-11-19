export interface LicenseReminderOverview {
  schoolId:string;schoolName:string;activeAdminCount:number;eligibleAdminCount:number;recipientCount:number;invalidPhoneCount:number;
  skipped:Array<{userId:string;maskedPhone:string;reason:string}>;recipients:Array<{userId:string;maskedPhone:string}>;
  expiresAt:string|null;nextAutomaticAt:string|null;automaticEnabled:boolean;manualEnabled:boolean;manualBlockedReason:string|null;
  counts:{total:number;accepted:number;delivered:number;failed:number;unknown:number;waiting:number;lastAttemptAt:string|null;lastSentAt:string|null};
  history:Array<{id:string;source:'AUTO'|'MANUAL';operationId:string|null;actorUserId:string|null;maskedPhone:string|null;status:string;deliveryStatus:string;reason:string|null;days:number;createdAt:string;completedAt:string|null}>;
  operations:Array<{id:string;status:string;recipientCount:number;createdAt:string}>;
  page:number;pageSize:number;
}
export interface LicenseReminderPreview {operationId:string;schoolName:string;recipientCount:number;blockedRecipients?:Array<{maskedPhone:string;reason:string}>;recipients:Array<{maskedPhone:string}>;template:string;language:string;days:number;expiryDate:string;live:boolean;expiresAt:string}
