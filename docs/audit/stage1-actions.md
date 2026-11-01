# שלב 1 — ביקורת כל הפעולות (Server Actions)

נוצר אוטומטית מהקוד. בדיקה קבועה: `apps/web/tests/unit/actions-audit.test.ts` (רצה בכל CI).

סה"כ פעולות: **289**. תקלות שנמצאו ותוקנו: 2 מפתחות תרגום חסרים (`ai.self_check_timeout`, `ai.empty_retry_timeout`). פעולות ללא זיהוי משתמש או בלי בדיקת הרשאה שלא סווגו כציבוריות/אישיות: **0**.

| מודול | פעולה | קובץ | הרשאה | ולידציה | סטטוס |
|---|---|---|---|---|---|
| (onboarding) | createOrganizationAction | app/[locale]/(onboarding)/onboarding/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (onboarding) | acceptInvitationAction | app/[locale]/(onboarding)/onboarding/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (onboarding) | switchOrganizationAction | app/[locale]/(onboarding)/onboarding/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (auth) | signInAction | app/[locale]/(auth)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (auth) | signUpAction | app/[locale]/(auth)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Email, Domains |
| (auth) | forgotPasswordAction | app/[locale]/(auth)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (auth) | updatePasswordAction | app/[locale]/(auth)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (auth) | signInWithGoogleAction | app/[locale]/(auth)/actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד בקוד · אימות חי דורש: Google |
| (auth) | signOutAction | app/[locale]/(auth)/actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד בקוד · אימות חי דורש: Email |
| views-actions.ts | saveViewAction | app/[locale]/(dashboard)/views-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| views-actions.ts | deleteViewAction | app/[locale]/(dashboard)/views-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| overview | loadDemoDataAction | app/[locale]/(dashboard)/overview/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| overview | liveFeedAction | app/[locale]/(dashboard)/overview/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| admin | setPlanAction | app/[locale]/(dashboard)/admin/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| admin | setFlagAction | app/[locale]/(dashboard)/admin/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| admin | probeAiAction | app/[locale]/(dashboard)/admin/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| admin | resetAiRestsAction | app/[locale]/(dashboard)/admin/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| admin | loadOrgOverridesAction | app/[locale]/(dashboard)/admin/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| admin | saveOverridesAction | app/[locale]/(dashboard)/admin/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| admin | grantCreditsAction | app/[locale]/(dashboard)/admin/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| admin | adminAssignPhoneAction | app/[locale]/(dashboard)/admin/phone-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| admin | adminBuyPhoneAction | app/[locale]/(dashboard)/admin/phone-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| admin | adminReleasePhoneAction | app/[locale]/(dashboard)/admin/phone-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| admin | checkPlatformSetupAction | app/[locale]/(dashboard)/admin/setup-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| companies | createCompanyAction | app/[locale]/(dashboard)/companies/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Domains |
| companies | updateCompanyAction | app/[locale]/(dashboard)/companies/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Domains |
| companies | deleteCompanyAction | app/[locale]/(dashboard)/companies/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| companies | linkContactAction | app/[locale]/(dashboard)/companies/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| crm | createContactAction | app/[locale]/(dashboard)/crm/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| crm | updateContactAction | app/[locale]/(dashboard)/crm/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| crm | deleteContactAction | app/[locale]/(dashboard)/crm/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| crm | addNoteAction | app/[locale]/(dashboard)/crm/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| crm | aiContactAction | app/[locale]/(dashboard)/crm/ai-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| crm | refreshScoreAction | app/[locale]/(dashboard)/crm/insight-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| crm | analyzeContactAction | app/[locale]/(dashboard)/crm/insight-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Twilio/voice |
| crm | callWithAgentAction | app/[locale]/(dashboard)/crm/insight-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| crm | addMemoryAction | app/[locale]/(dashboard)/crm/memory-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| crm | deleteMemoryAction | app/[locale]/(dashboard)/crm/memory-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| crm | eraseContactAction | app/[locale]/(dashboard)/crm/privacy-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| crm | importContactsAction | app/[locale]/(dashboard)/crm/suite-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| crm | setContactTagsAction | app/[locale]/(dashboard)/crm/suite-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| crm | mergeContactsAction | app/[locale]/(dashboard)/crm/suite-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| agents | saveAgentAction | app/[locale]/(dashboard)/agents/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| agents | runAgentNowAction | app/[locale]/(dashboard)/agents/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| agents | savePlusAgentAction | app/[locale]/(dashboard)/agents/plus-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| agents | runPlusAgentNowAction | app/[locale]/(dashboard)/agents/plus-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| operator | operatorPlanAction | app/[locale]/(dashboard)/operator/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| operator | operatorExecuteAction | app/[locale]/(dashboard)/operator/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| team | createInvitationAction | app/[locale]/(dashboard)/team/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Email |
| team | revokeInvitationAction | app/[locale]/(dashboard)/team/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| team | changeRoleAction | app/[locale]/(dashboard)/team/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| team | removeMemberAction | app/[locale]/(dashboard)/team/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| social | replyCommentAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| social | commentStatusAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| social | savePostAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| social | postStatusAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| social | saveSocialSettingsAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| social | replyReviewAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Google |
| social | reviewSettingsAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Google |
| social | duplicatePostAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| social | approveAllDraftsAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta, Twilio/voice |
| social | aiWritePostAction | app/[locale]/(dashboard)/social/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Meta, Twilio/voice |
| social | saveAutopilotAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Telegram |
| social | smartPostNowAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| social | planWeekAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| social | repurposeAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Meta, Telegram |
| social | hashtagsAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: AI model, Meta |
| social | recyclePostAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Telegram |
| social | refreshBrainAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| social | testTelegramChannelAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Telegram |
| social | getPostAction | app/[locale]/(dashboard)/social/brain-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| social | aiImageAction | app/[locale]/(dashboard)/social/studio-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Twilio/voice |
| social | aiMoreTextAction | app/[locale]/(dashboard)/social/studio-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Meta, Twilio/voice |
| social | listAssetsAction | app/[locale]/(dashboard)/social/studio-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| social | saveAssetAction | app/[locale]/(dashboard)/social/studio-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| social | deleteAssetAction | app/[locale]/(dashboard)/social/studio-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| social | aiImageProAction | app/[locale]/(dashboard)/social/studio-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Twilio/voice |
| social | aiFullPostAction | app/[locale]/(dashboard)/social/studio-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Meta, Twilio/voice |
| social | createMediaUploadAction | app/[locale]/(dashboard)/social/studio-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| tasks | createTaskAction | app/[locale]/(dashboard)/tasks/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| tasks | updateTaskAction | app/[locale]/(dashboard)/tasks/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| tasks | setTaskStatusAction | app/[locale]/(dashboard)/tasks/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| tasks | deleteTaskAction | app/[locale]/(dashboard)/tasks/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | createDealAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | updateDealAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | moveDealAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | setDealStatusAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | deleteDealAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | createPipelineAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | renamePipelineAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | deletePipelineAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | addStageAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | updateStageAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | updateStageAutomationAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | moveStageAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| pipelines | deleteStageAction | app/[locale]/(dashboard)/pipelines/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| websites | saveSiteAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| websites | deleteSiteAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| websites | buildSiteWithAIAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: AI model |
| websites | heroImageAIAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| websites | uploadSiteImageAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| websites | aiEditSiteAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| websites | duplicateSiteAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| websites | bulkSitesAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| websites | landingFromCampaignAction | app/[locale]/(dashboard)/websites/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| websites | searchDomainsAction | app/[locale]/(dashboard)/websites/domain-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Domains |
| websites | connectDomainAction | app/[locale]/(dashboard)/websites/domain-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta, Domains |
| websites | checkDomainAction | app/[locale]/(dashboard)/websites/domain-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Domains |
| websites | disconnectDomainAction | app/[locale]/(dashboard)/websites/domain-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Domains |
| websites | createDomainOrderAction | app/[locale]/(dashboard)/websites/domain-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Payments, Domains |
| websites | captureDomainOrderAction | app/[locale]/(dashboard)/websites/domain-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Payments, Domains |
| websites | saveAbTestAction | app/[locale]/(dashboard)/websites/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| websites | stopAbTestAction | app/[locale]/(dashboard)/websites/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| websites | aiAbVariantAction | app/[locale]/(dashboard)/websites/growth-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| websites | improveCopyAction | app/[locale]/(dashboard)/websites/growth-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| finance | saveDocumentAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| finance | sendDocumentAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| finance | setDocumentStatusAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| finance | convertToInvoiceAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| finance | deleteDocumentAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| finance | recordPaymentAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| finance | deletePaymentAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| finance | saveProductAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| finance | deleteProductAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| finance | saveFinanceSettingsAction | app/[locale]/(dashboard)/finance/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Payments |
| finance | saveOrgPayPalAction | app/[locale]/(dashboard)/finance/plus-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice, Payments |
| finance | saveInvoicingAction | app/[locale]/(dashboard)/finance/plus-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| finance | issueTaxDocAction | app/[locale]/(dashboard)/finance/plus-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| finance | createPaymentLinkAction | app/[locale]/(dashboard)/finance/plus-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| settings | updateOrganizationAction | app/[locale]/(dashboard)/settings/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| settings | updateProfileAction | app/[locale]/(dashboard)/settings/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | markNotificationsReadAction | app/[locale]/(dashboard)/settings/actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד (סטטי) |
| settings | updateProfileProAction | app/[locale]/(dashboard)/settings/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | createAvatarUploadAction | app/[locale]/(dashboard)/settings/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | setAvatarAction | app/[locale]/(dashboard)/settings/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | updateCalendarAction | app/[locale]/(dashboard)/settings/calendar-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | saveConversationPolicyAction | app/[locale]/(dashboard)/settings/policy-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| settings | subscribePushAction | app/[locale]/(dashboard)/settings/push-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | unsubscribePushAction | app/[locale]/(dashboard)/settings/push-actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד (סטטי) |
| settings | testPushAction | app/[locale]/(dashboard)/settings/push-actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד (סטטי) |
| settings | mfaStatusAction | app/[locale]/(dashboard)/settings/security-actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד (סטטי) |
| settings | mfaEnrollAction | app/[locale]/(dashboard)/settings/security-actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד (סטטי) |
| settings | mfaVerifyAction | app/[locale]/(dashboard)/settings/security-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | mfaDisableAction | app/[locale]/(dashboard)/settings/security-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | mfaLoginAction | app/[locale]/(dashboard)/settings/security-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | signOutOthersAction | app/[locale]/(dashboard)/settings/security-actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד (סטטי) |
| settings | addMyChannelAction | app/[locale]/(dashboard)/settings/team-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Telegram |
| settings | updateMyChannelAction | app/[locale]/(dashboard)/settings/team-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | deleteMyChannelAction | app/[locale]/(dashboard)/settings/team-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| settings | setMyAvailabilityAction | app/[locale]/(dashboard)/settings/team-actions.ts | ציבורי/חשבון אישי (נבדק) | — | עובד (סטטי) |
| settings | saveLeadRoutingAction | app/[locale]/(dashboard)/settings/team-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| billing | startCheckoutAction | app/[locale]/(dashboard)/billing/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Payments |
| billing | openPortalAction | app/[locale]/(dashboard)/billing/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Payments |
| billing | startPaymentAction | app/[locale]/(dashboard)/billing/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice, Payments |
| billing | cancelPayPalAction | app/[locale]/(dashboard)/billing/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Payments |
| billing | createCardOrderAction | app/[locale]/(dashboard)/billing/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Payments |
| billing | captureCardOrderAction | app/[locale]/(dashboard)/billing/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Payments |
| billing | buyCreditPackAction | app/[locale]/(dashboard)/billing/credit-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Twilio/voice, Payments |
| billing | startTrialAction | app/[locale]/(dashboard)/billing/trial-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| integrations | createApiKeyAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| integrations | revokeApiKeyAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| integrations | saveWebhookAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| integrations | toggleWebhookAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| integrations | deleteWebhookAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| integrations | rotateWebhookSecretAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Telegram |
| integrations | connectChannelAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Twilio/voice, Telegram |
| integrations | disconnectChannelAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Email, Telegram, Domains |
| integrations | connectMailboxAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Email |
| integrations | disconnectChannelV2Action | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Telegram |
| integrations | connectWhatsAppEmbeddedAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| integrations | startWhatsAppQrAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| integrations | whatsAppQrStatusAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta, Telegram |
| integrations | startTelegramUserAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| integrations | telegramUserStatusAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Telegram |
| integrations | telegramUserPasswordAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta, Telegram |
| integrations | addRecipientAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Telegram |
| integrations | updateRecipientAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| integrations | deleteRecipientAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| integrations | testRecipientAction | app/[locale]/(dashboard)/integrations/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Telegram |
| integrations | connectMetaPagesAction | app/[locale]/(dashboard)/integrations/connect-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| integrations | chooseMetaPageAction | app/[locale]/(dashboard)/integrations/connect-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| integrations | disconnectMetaPagesAction | app/[locale]/(dashboard)/integrations/connect-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| integrations | saveConversionsAction | app/[locale]/(dashboard)/integrations/growth-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| integrations | testConversionAction | app/[locale]/(dashboard)/integrations/growth-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| integrations | saveOwnAppAction | app/[locale]/(dashboard)/integrations/meta-own-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| integrations | retryOwnWebhooksAction | app/[locale]/(dashboard)/integrations/meta-own-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| integrations | revealOwnVerifyTokenAction | app/[locale]/(dashboard)/integrations/meta-own-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| integrations | removeOwnAppAction | app/[locale]/(dashboard)/integrations/meta-own-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| integrations | requestTesterAction | app/[locale]/(dashboard)/integrations/meta-own-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| integrations | markTesterRequestAction | app/[locale]/(dashboard)/integrations/meta-own-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| integrations | pairWhatsAppAction | app/[locale]/(dashboard)/integrations/whatsapp-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| integrations | registerWhatsAppAction | app/[locale]/(dashboard)/integrations/whatsapp-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| integrations | diagnoseWhatsAppAction | app/[locale]/(dashboard)/integrations/whatsapp-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Meta |
| health | retryDeliveryAction | app/[locale]/(dashboard)/health/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| health | retryAllDeliveriesAction | app/[locale]/(dashboard)/health/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| health | testEmailAction | app/[locale]/(dashboard)/health/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Email |
| health | saveSurveySettingsAction | app/[locale]/(dashboard)/health/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| health | resolveErrorAction | app/[locale]/(dashboard)/health/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| support | createTicketAction | app/[locale]/(dashboard)/support/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| support | replyTicketAction | app/[locale]/(dashboard)/support/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| support | updateTicketAction | app/[locale]/(dashboard)/support/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| support | deleteTicketAction | app/[locale]/(dashboard)/support/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| support | saveArticleAction | app/[locale]/(dashboard)/support/kb-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| support | deleteArticleAction | app/[locale]/(dashboard)/support/kb-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | saveAgentAction | app/[locale]/(dashboard)/ai-agents/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Telegram |
| ai-agents | deleteAgentAction | app/[locale]/(dashboard)/ai-agents/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | agentChatAction | app/[locale]/(dashboard)/ai-agents/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| ai-agents | createQuickAgentAction | app/[locale]/(dashboard)/ai-agents/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Telegram |
| ai-agents | saveAgentSetupAction | app/[locale]/(dashboard)/ai-agents/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Telegram |
| ai-agents | uploadAgentMediaAction | app/[locale]/(dashboard)/ai-agents/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | listConversationsAction | app/[locale]/(dashboard)/ai-agents/chat-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | loadConversationAction | app/[locale]/(dashboard)/ai-agents/chat-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| ai-agents | deleteConversationAction | app/[locale]/(dashboard)/ai-agents/chat-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | sendAgentMessageAction | app/[locale]/(dashboard)/ai-agents/chat-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Meta |
| ai-agents | importSiteAction | app/[locale]/(dashboard)/ai-agents/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | applySiteImportAction | app/[locale]/(dashboard)/ai-agents/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | decideLearningAction | app/[locale]/(dashboard)/ai-agents/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | saveOpenersAction | app/[locale]/(dashboard)/ai-agents/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | coachNowAction | app/[locale]/(dashboard)/ai-agents/growth-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| ai-agents | saveGuardrailsAction | app/[locale]/(dashboard)/ai-agents/plus-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| ai-agents | saveFlowAction | app/[locale]/(dashboard)/ai-agents/plus-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | deleteFlowAction | app/[locale]/(dashboard)/ai-agents/plus-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| ai-agents | saveVoiceAction | app/[locale]/(dashboard)/ai-agents/voice-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice |
| ai-agents | previewVoiceAction | app/[locale]/(dashboard)/ai-agents/voice-actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Twilio/voice |
| inbox | replyAction | app/[locale]/(dashboard)/inbox/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | startConversationAction | app/[locale]/(dashboard)/inbox/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta, Telegram |
| inbox | markReadAction | app/[locale]/(dashboard)/inbox/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | updateConversationAction | app/[locale]/(dashboard)/inbox/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | setAiModeAction | app/[locale]/(dashboard)/inbox/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | suggestRepliesAction | app/[locale]/(dashboard)/inbox/copilot-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| inbox | summarizeConversationAction | app/[locale]/(dashboard)/inbox/copilot-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| inbox | applyExtractedFieldsAction | app/[locale]/(dashboard)/inbox/copilot-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | startVideoCallAction | app/[locale]/(dashboard)/inbox/copilot-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | rewriteDraftAction | app/[locale]/(dashboard)/inbox/copilot-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| inbox | scheduleMessageAction | app/[locale]/(dashboard)/inbox/guard-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | cancelScheduleAction | app/[locale]/(dashboard)/inbox/guard-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | setOptOutAction | app/[locale]/(dashboard)/inbox/guard-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | setSalesStateAction | app/[locale]/(dashboard)/inbox/sales-state-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | listSavedRepliesAction | app/[locale]/(dashboard)/inbox/saved-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| inbox | createSavedReplyAction | app/[locale]/(dashboard)/inbox/saved-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | deleteSavedReplyAction | app/[locale]/(dashboard)/inbox/saved-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| inbox | countSavedReplyUseAction | app/[locale]/(dashboard)/inbox/saved-actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| inbox | addStarterRepliesAction | app/[locale]/(dashboard)/inbox/saved-actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| appointments | saveAppointmentTypeAction | app/[locale]/(dashboard)/appointments/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| appointments | deleteAppointmentTypeAction | app/[locale]/(dashboard)/appointments/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| appointments | createAppointmentAction | app/[locale]/(dashboard)/appointments/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| appointments | setAppointmentStatusAction | app/[locale]/(dashboard)/appointments/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| appointments | rescheduleAppointmentAction | app/[locale]/(dashboard)/appointments/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| appointments | updateAppointmentNotesAction | app/[locale]/(dashboard)/appointments/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| phone | getPhoneNumberAction | app/[locale]/(dashboard)/phone/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Twilio/voice |
| phone | releasePhoneNumberAction | app/[locale]/(dashboard)/phone/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Twilio/voice |
| phone | wireOwnNumberAction | app/[locale]/(dashboard)/phone/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Twilio/voice |
| phone | setTransferNumberAction | app/[locale]/(dashboard)/phone/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| phone | testCallAction | app/[locale]/(dashboard)/phone/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: Twilio/voice |
| phone | savePhoneSettingsAction | app/[locale]/(dashboard)/phone/actions.ts | הרשאה ✓ | — | עובד (סטטי) |
| campaigns | saveCampaignAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Meta |
| campaigns | previewAudienceAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| campaigns | launchCampaignAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| campaigns | cancelCampaignAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| campaigns | deleteCampaignAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| campaigns | aiSegmentAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: AI model |
| campaigns | duplicateCampaignAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| campaigns | aiWriteCampaignAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| campaigns | aiImproveMessageAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| campaigns | aiSubjectIdeasAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | — | עובד בקוד · אימות חי דורש: AI model |
| campaigns | aiCampaignAgentAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Meta |
| campaigns | aiCampaignCoachAction | app/[locale]/(dashboard)/campaigns/actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model |
| forms | saveFormAction | app/[locale]/(dashboard)/forms/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| forms | deleteFormAction | app/[locale]/(dashboard)/forms/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| analytics | saveSpendAction | app/[locale]/(dashboard)/analytics/growth-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: Payments |
| analytics | deleteSpendAction | app/[locale]/(dashboard)/analytics/growth-actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| analytics | aiGrowthInsightAction | app/[locale]/(dashboard)/analytics/growth-actions.ts | הרשאה ✓ | ✓ | עובד בקוד · אימות חי דורש: AI model, Payments |
| automations | saveAutomationAction | app/[locale]/(dashboard)/automations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| automations | toggleAutomationAction | app/[locale]/(dashboard)/automations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| automations | deleteAutomationAction | app/[locale]/(dashboard)/automations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| automations | testAutomationAction | app/[locale]/(dashboard)/automations/actions.ts | הרשאה ✓ | ✓ | עובד (סטטי) |
| (public) | submitPublicForm | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Meta |
| (public) | bookPublicAppointment | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Meta |
| (public) | cancelPublicAppointment | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (public) | unsubscribePublic | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (public) | createPublicTicket | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Meta |
| (public) | replyPublicTicket | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Meta, Twilio/voice |
| (public) | acceptPublicQuote | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (public) | startDocumentPayment | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice, Payments |
| (public) | signPublicQuote | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Meta |
| (public) | startDocumentPayPal | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד בקוד · אימות חי דורש: Twilio/voice, Payments |
| (public) | performActAction | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (public) | markArticleHelpful | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
| (public) | answerSurveyAction | app/[locale]/(public)/actions.ts | ציבורי/חשבון אישי (נבדק) | ✓ | עובד (סטטי) |
