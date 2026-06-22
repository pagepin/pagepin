import type { ReactElement } from 'react';

/** Sign-in / sign-up (password instance, social + email). */
export declare function LoginScreen(): ReactElement;
/** Standalone open-registration sign-up. */
export declare function SignupScreen(): ReactElement;
/** Claim-an-invite account creation. */
export declare function AcceptInviteScreen(): ReactElement;
/** Device-authorization approval (CLI / AI tool login). */
export declare function ActivateScreen(): ReactElement;
/** First-login handle setup. */
export declare function HandleSetupScreen(): ReactElement;
/** Authenticated home: top bar + deploy drop-zone + site list. */
export declare function SitesScreen(): ReactElement;
/** A single expandable site card with share / settings / versions panels. */
export declare function SiteCardScreen(): ReactElement;
/** Account settings: profile, password, usage, API tokens. */
export declare function SettingsScreen(): ReactElement;
/** Instance admin: overview, users, invites, registration. */
export declare function AdminScreen(): ReactElement;
/** API-token manager (create / rotate / revoke). */
export declare function TokenManagerScreen(): ReactElement;
/** API-token manager in its modal dialog. */
export declare function TokenDialogScreen(): ReactElement;
/** Change-password modal dialog. */
export declare function PasswordDialogScreen(): ReactElement;
/** Full clickable console prototype — real routing across every screen. */
export declare function ConsolePrototype(): ReactElement;
