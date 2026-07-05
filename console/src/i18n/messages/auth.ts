/** auth 文案域:登录 / 注册、接受邀请、首登 handle 设置、设备授权(/activate)。
 *
 * 覆盖组件:Login / Signup / AcceptInvite / HandleSetup / Activate。
 * 与服务端约定一致:en/zh key 集合须一致、跨域不重复;通用动作复用 common.*。
 */

import type { Locale } from '../index';

export const auth: Record<Locale, Record<string, string>> = {
  en: {
    // —— Login.tsx ——
    'auth.signInTitle': 'Sign in to pagepin',
    'auth.ssoDesc': 'This instance uses single sign-on. Continue with your identity provider.',
    'auth.continueWithSso': 'Continue with SSO',
    'auth.configuredVia': 'Configured via',
    'auth.loginSubtitle': 'Use your email and password.',
    'auth.emailPlaceholder': 'Email',
    'auth.passwordPlaceholder': 'Password',
    'auth.passwordMinPlaceholder': 'At least 8 characters',
    'auth.signIn': 'Sign in',
    'auth.signUp': 'Sign up',
    'auth.alreadyHaveAccount': 'Already have an account?',
    'auth.noAccountYet': 'No account yet?',
    'auth.enterEmailPassword': 'Please enter your email and password',
    'auth.passwordTooShort': 'Password must be at least 8 characters',
    'auth.completeVerification': 'Please complete the verification below',
    'auth.requestFailed': 'Request failed',
    'auth.or': 'or',
    'auth.continueWithGoogle': 'Continue with Google',
    'auth.continueWithGithub': 'Continue with GitHub',
    'auth.continueWith': 'Continue with {provider}',

    // —— shared (Login / Signup / AcceptInvite) ——
    'auth.createAccountTitle': 'Create your account',
    'auth.signupSubtitle': 'Host static pages and collect pin-point review comments.',
    'auth.displayNamePlaceholder': 'Display name (optional)',
    'auth.emailExamplePlaceholder': 'you@email.com',
    'auth.passwordMin8Period': 'Password must be at least 8 characters.',
    'auth.goToSignIn': 'Go to sign in',
    'auth.registrationClosed': 'Registration is closed',

    // —— Signup.tsx ——
    'auth.couldNotSignUp': 'Could not sign up',
    'auth.inviteOnly': 'This instance is invite-only. Ask an admin for an invite link.',
    'auth.signupsDisabled': 'New sign-ups are disabled on this instance.',

    // —— AcceptInvite.tsx ——
    'auth.couldNotCreateAccount': 'Could not create account',
    'auth.inviteErrNetworkTitle': "Couldn't load this invite",
    'auth.inviteErrNetworkBody':
      "We couldn't reach the server. Check your connection and try again.",
    'auth.inviteErrClosedBody':
      'This instance has stopped accepting new accounts. Ask an admin to re-open registration.',
    'auth.inviteErrInvalidTitle': "This invite can't be used",
    'auth.inviteErrInvalidBody':
      'Invite links are one-time and expire after a short window. This one has already been used or has passed its window.',
    'auth.tryAgain': 'Try again',
    'auth.youreInvited': "You're invited",
    'auth.asAdminSuffix': ' · as admin',
    'auth.setPasswordTitle': 'Set a password to join',
    'auth.inviteLockedEmailDesc':
      'Your account will be created with the email your invite was sent to.',
    'auth.inviteChooseEmailDesc': 'Choose the email and password for your new account.',
    'auth.fromInvite': 'From invite',
    'auth.reenterPasswordPlaceholder': 'Re-enter password',
    'auth.passwordsMismatch': "Passwords don't match.",
    'auth.readyToCreate': 'Looks good — ready to create your account.',
    'auth.createAndSignIn': 'Create account & sign in',

    // —— HandleSetup.tsx ——
    'auth.handleHint': '2–32 chars: lowercase letters, digits, or hyphens, starting with a letter',
    'auth.verifyEmailSent': 'Verification email sent',
    'auth.emailSendingNotConfigured': 'Email sending is not configured',
    'auth.couldNotSend': 'Could not send',
    'auth.verifyEmailTitle': 'Verify your email first',
    'auth.verifyEmailBodyBefore': 'We sent a link to ',
    'auth.verifyEmailBodyAfter':
      '. Click it to confirm your email — then you can pick a handle and publish sites.',
    'auth.resendVerifyEmail': 'Resend verification email',
    'auth.alreadyClickedReload': 'Already clicked it? Reload this page.',
    'auth.handleNotAvailable': 'Not available',
    'auth.handleSet': 'Handle set to @{handle}',
    'auth.handleTaken': 'Already taken — try another',
    'auth.handleInvalidFormat': 'Invalid format',
    'auth.pickHandleTitle': 'Pick a handle',
    'auth.handleAppearsIn': 'It appears in every share link:',
    'auth.yourHandlePlaceholder': 'your-handle',
    'auth.handleAvailable': 'That name is available.',
    'auth.claimHandle': 'Claim @{handle}',
    'auth.handleImmutable': "Can't be changed once set.",

    // —— Activate.tsx ——
    'auth.yourAccount': 'your account',
    'auth.deviceMissingTitle': 'Missing device code',
    'auth.deviceMissingBody':
      'Open the link your tool printed, or start the login again from your terminal.',
    'auth.deviceApprovedTitle': 'Approved',
    'auth.deviceApprovedBody':
      'Return to your terminal — the token has been delivered to the tool that started this. You can close this tab.',
    'auth.deviceDeniedTitle': 'Request denied',
    'auth.deviceDeniedBody':
      'No token was issued. If this was you, start the login again from your tool.',
    'auth.approvalFailed': 'Approval failed',
    'auth.couldNotDeny': 'Could not deny',
    'auth.deviceAuthLabel': 'Device authorization',
    'auth.deviceApproveTitle': 'Approve this sign-in?',
    'auth.deviceRequestBefore': 'A tool is requesting an API token for ',
    'auth.deviceRequestAfter':
      '. Only approve if the code below matches what your tool is showing.',
    'auth.approve': 'Approve',
    'auth.deny': 'Deny',
    'auth.deviceTokenNote':
      'The token is delivered straight to the tool that started this — it is never shown here or pasted into a chat.',
    'auth.deviceHandleGateTitle': 'Approved — one more step',
    'auth.deviceHandleGateBody':
      'The token was delivered, but deploys will fail with “handle required” until you claim your handle below.',
    'auth.deviceAgentTip':
      'Tip: tell your AI to save this guide as a skill or long-term memory, so future sessions can deploy and read review comments right away:',
  },
  zh: {
    // —— Login.tsx ——
    'auth.signInTitle': '登录 pagepin',
    'auth.ssoDesc': '本实例使用单点登录，请通过你的身份提供方继续。',
    'auth.continueWithSso': '使用 SSO 继续',
    'auth.configuredVia': '配置来自',
    'auth.loginSubtitle': '使用你的邮箱和密码。',
    'auth.emailPlaceholder': '邮箱',
    'auth.passwordPlaceholder': '密码',
    'auth.passwordMinPlaceholder': '至少 8 个字符',
    'auth.signIn': '登录',
    'auth.signUp': '注册',
    'auth.alreadyHaveAccount': '已有账号？',
    'auth.noAccountYet': '还没有账号？',
    'auth.enterEmailPassword': '请输入邮箱和密码',
    'auth.passwordTooShort': '密码至少需要 8 个字符',
    'auth.completeVerification': '请先完成下方的验证',
    'auth.requestFailed': '请求失败',
    'auth.or': '或',
    'auth.continueWithGoogle': '使用 Google 继续',
    'auth.continueWithGithub': '使用 GitHub 继续',
    'auth.continueWith': '使用 {provider} 继续',

    // —— shared (Login / Signup / AcceptInvite) ——
    'auth.createAccountTitle': '创建你的账号',
    'auth.signupSubtitle': '托管静态页面，收集打点评审意见。',
    'auth.displayNamePlaceholder': '显示名称（可选）',
    'auth.emailExamplePlaceholder': 'you@email.com',
    'auth.passwordMin8Period': '密码至少需要 8 个字符。',
    'auth.goToSignIn': '前往登录',
    'auth.registrationClosed': '注册已关闭',

    // —— Signup.tsx ——
    'auth.couldNotSignUp': '无法注册',
    'auth.inviteOnly': '本实例仅限受邀注册。请向管理员索取邀请链接。',
    'auth.signupsDisabled': '本实例已停用新用户注册。',

    // —— AcceptInvite.tsx ——
    'auth.couldNotCreateAccount': '无法创建账号',
    'auth.inviteErrNetworkTitle': '无法加载此邀请',
    'auth.inviteErrNetworkBody': '我们无法连接服务器。请检查网络后重试。',
    'auth.inviteErrClosedBody': '本实例已停止接受新账号。请联系管理员重新开放注册。',
    'auth.inviteErrInvalidTitle': '此邀请无法使用',
    'auth.inviteErrInvalidBody':
      '邀请链接一次性有效，且在短暂时间窗后过期。此链接已被使用或已过期。',
    'auth.tryAgain': '重试',
    'auth.youreInvited': '你被邀请加入',
    'auth.asAdminSuffix': ' · 作为管理员',
    'auth.setPasswordTitle': '设置密码以加入',
    'auth.inviteLockedEmailDesc': '你的账号将使用邀请所发往的邮箱创建。',
    'auth.inviteChooseEmailDesc': '为新账号选择邮箱和密码。',
    'auth.fromInvite': '来自邀请',
    'auth.reenterPasswordPlaceholder': '再次输入密码',
    'auth.passwordsMismatch': '两次输入的密码不一致。',
    'auth.readyToCreate': '没问题 —— 可以创建账号了。',
    'auth.createAndSignIn': '创建账号并登录',

    // —— HandleSetup.tsx ——
    'auth.handleHint': '2–32 个字符：小写字母、数字或连字符，且以字母开头',
    'auth.verifyEmailSent': '验证邮件已发送',
    'auth.emailSendingNotConfigured': '邮件发送尚未配置',
    'auth.couldNotSend': '发送失败',
    'auth.verifyEmailTitle': '请先验证你的邮箱',
    'auth.verifyEmailBodyBefore': '我们已向 ',
    'auth.verifyEmailBodyAfter':
      ' 发送了一个链接。点击它确认邮箱 —— 然后即可选择 handle 并发布站点。',
    'auth.resendVerifyEmail': '重新发送验证邮件',
    'auth.alreadyClickedReload': '已经点击过了？刷新此页面。',
    'auth.handleNotAvailable': '不可用',
    'auth.handleSet': 'Handle 已设为 @{handle}',
    'auth.handleTaken': '已被占用 —— 换一个试试',
    'auth.handleInvalidFormat': '格式无效',
    'auth.pickHandleTitle': '选择一个 handle',
    'auth.handleAppearsIn': '它会出现在每个分享链接中：',
    'auth.yourHandlePlaceholder': 'your-handle',
    'auth.handleAvailable': '该名称可用。',
    'auth.claimHandle': '认领 @{handle}',
    'auth.handleImmutable': '设定后不可更改。',

    // —— Activate.tsx ——
    'auth.yourAccount': '你的账号',
    'auth.deviceMissingTitle': '缺少设备码',
    'auth.deviceMissingBody': '打开你的工具打印出的链接，或在终端重新发起登录。',
    'auth.deviceApprovedTitle': '已批准',
    'auth.deviceApprovedBody':
      '返回你的终端 —— token 已交付给发起此次请求的工具。你可以关闭此标签页。',
    'auth.deviceDeniedTitle': '请求已拒绝',
    'auth.deviceDeniedBody': '未签发任何 token。如果这是你本人操作，请从工具重新发起登录。',
    'auth.approvalFailed': '批准失败',
    'auth.couldNotDeny': '无法拒绝',
    'auth.deviceAuthLabel': '设备授权',
    'auth.deviceApproveTitle': '批准此次登录？',
    'auth.deviceRequestBefore': '某个工具正在为 ',
    'auth.deviceRequestAfter': ' 申请 API token。只有当下方代码与你的工具所显示的一致时才批准。',
    'auth.approve': '批准',
    'auth.deny': '拒绝',
    'auth.deviceTokenNote':
      'token 会直接交付给发起此次请求的工具 —— 永远不会在此处显示或粘贴到聊天中。',
    'auth.deviceHandleGateTitle': '已批准 —— 还差一步',
    'auth.deviceHandleGateBody':
      'token 已交付，但在下方设置好 handle 之前，agent 的部署会报「需要 handle」。',
    'auth.deviceAgentTip':
      '小提示：让你的 AI 把这份指南保存为技能或长期记忆，之后的新会话就能直接部署、读取页面评论：',
  },
};
