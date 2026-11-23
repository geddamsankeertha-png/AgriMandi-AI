/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  Mail,
  Lock,
  User,
  MapPin,
  ArrowRight,
  Eye,
  EyeOff,
  Sprout,
  Briefcase,
  GraduationCap,
  AlertCircle,
  RefreshCw,
  Phone,
  Send,
} from 'lucide-react';
import { IndianState, UserProfile } from '../types/mandi';
import { INDIAN_STATES, STATE_METADATA } from '../data/mandiData';
import { predictionApi } from '../services/predictionApi';

interface RegisterPageProps {
  onRegisterSuccess: (user: UserProfile) => void;
  onNavigateToLogin: () => void;
  onNavigateToHome: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  onRegisterSuccess,
  onNavigateToLogin,
  onNavigateToHome,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [role, setRole] = useState<'farmer' | 'trader' | 'analyst'>('farmer');
  const [selectedState, setSelectedState] = useState<IndianState>('Maharashtra');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [pendingVerification, setPendingVerification] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [registeredRole, setRegisteredRole] = useState<'farmer' | 'trader' | 'analyst'>('farmer');
  const [registeredName, setRegisteredName] = useState('');
  const [emailSentStatus, setEmailSentStatus] = useState<boolean>(false);
  const [emailErrorMsg, setEmailErrorMsg] = useState<string | null>(null);
  const [devVerifyToken, setDevVerifyToken] = useState<string | null>(null);

  const [verifyingFromLink, setVerifyingFromLink] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState<UserProfile | null>(null);
  const [alreadyVerifiedNotice, setAlreadyVerifiedNotice] = useState(false);
  const [linkVerifyFailed, setLinkVerifyFailed] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [otpOrLinkInput, setOtpOrLinkInput] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const verifyTriggeredRef = useRef(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [isDuplicateEmail, setIsDuplicateEmail] = useState(false);
  const [duplicateRequiresVerification, setDuplicateRequiresVerification] = useState(false);
  const [resendSuccessMsg, setResendSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const roleDashboardLabels: Record<'farmer' | 'trader' | 'analyst', string> = {
    farmer: 'Farmer Decision Dashboard',
    trader: 'Trader Market Terminal',
    analyst: 'Analyst Econometric Dashboard',
  };

  const completeEmailTokenVerification = async (token: string) => {
    setFormError(null);
    setLinkVerifyFailed(false);
    setAlreadyVerifiedNotice(false);
    setVerifyingFromLink(true);
    try {
      const res = await predictionApi.verifyEmail(token);
      if (res.user) {
        setVerifiedUser(res.user);
        setPendingVerification(false);
        setTimeout(() => {
          onRegisterSuccess(res.user!);
        }, 800);
      } else if (res.alreadyVerified) {
        setAlreadyVerifiedNotice(true);
        setPendingVerification(false);
      } else {
        setAlreadyVerifiedNotice(true);
      }
    } catch (err: any) {
      setLinkVerifyFailed(true);
      setFormError(err?.message || 'Verification link is invalid or has expired.');
    } finally {
      setVerifyingFromLink(false);
    }
  };

  const handleVerifyCodeOrLink = async (e: React.FormEvent, targetEmail?: string) => {
    e.preventDefault();
    const cleaned = otpOrLinkInput.trim();
    if (!cleaned) {
      setFormError('Enter the 6-digit code or paste the Verify Me link from your email.');
      return;
    }

    setFormError(null);
    setVerifyingCode(true);
    try {
      const isSixDigitCode = /^\d{6}$/.test(cleaned);
      const emailToVerify = (targetEmail || registeredEmail || recoveryEmail || email).trim().toLowerCase();
      if (isSixDigitCode && !emailToVerify) {
        setFormError('Please enter your registered email address alongside the 6-digit code.');
        return;
      }

      const res = await predictionApi.verifyEmail(
        isSixDigitCode ? { email: emailToVerify, code: cleaned } : cleaned
      );

      if (res.user) {
        setVerifiedUser(res.user);
        setPendingVerification(false);
        setLinkVerifyFailed(false);
        setOtpOrLinkInput('');
        setTimeout(() => {
          onRegisterSuccess(res.user!);
        }, 800);
      } else if (res.alreadyVerified) {
        setAlreadyVerifiedNotice(true);
        setPendingVerification(false);
        setLinkVerifyFailed(false);
      }
    } catch (err: any) {
      setFormError(err?.message || 'Invalid verification code or link. Please check your email and try again.');
    } finally {
      setVerifyingCode(false);
    }
  };

  // Detect ?token= from the "Verify Me" button clicked in the user's registered email
  useEffect(() => {
    if (typeof window === 'undefined' || verifyTriggeredRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      verifyTriggeredRef.current = true;
      window.history.replaceState({}, document.title, '/');
      void completeEmailTokenVerification(token);
    }
  }, []);

  const handleResendVerification = async (targetEmail: string, openPendingScreen = false) => {
    setFormError(null);
    setResendSuccessMsg(null);
    setIsSubmitting(true);
    try {
      const res = await predictionApi.resendVerification(targetEmail);
      setEmailSentStatus(Boolean(res.emailSent));
      setEmailErrorMsg(res.emailError || null);
      if (res.dev_token) setDevVerifyToken(res.dev_token);
      if (openPendingScreen) {
        setRegisteredEmail(targetEmail);
        setRegisteredName(fullName.trim() || 'User');
        setRegisteredRole(role);
        setIsDuplicateEmail(false);
        setDuplicateRequiresVerification(false);
        setPendingVerification(true);
      }
      if (res.emailSent) {
        setResendSuccessMsg(
          `A fresh "Verify Me" button and 6-digit code were sent to ${targetEmail}. Check your inbox.`
        );
      } else {
        setResendSuccessMsg(res.message || 'Verification request processed.');
      }
    } catch (err: any) {
      setFormError(err?.message || 'Unable to resend verification email right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setResendSuccessMsg(null);
    setIsDuplicateEmail(false);
    setDuplicateRequiresVerification(false);

    if (!fullName.trim()) {
      setFormError('Please enter your full name.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match. Please re-enter.');
      return;
    }

    setIsSubmitting(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const preferredMarket = STATE_METADATA[selectedState]?.capital || 'Central Mandi';
      const res = await predictionApi.register({
        displayName: fullName.trim(),
        email: cleanEmail,
        password,
        role,
        preferredState: selectedState,
        preferredDistrict: preferredMarket,
        preferredMarket,
        preferredCommodities: ['Tomato', 'Onion'],
        phone: phoneNumber.trim() || undefined,
        language: 'en',
      });

      setRegisteredEmail(cleanEmail);
      setRegisteredName(fullName.trim());
      setRegisteredRole(role);
      setEmailSentStatus(Boolean(res.emailSent));
      setEmailErrorMsg(res.emailError || null);
      setDevVerifyToken(res.dev_token || null);
      setOtpOrLinkInput('');
      setPendingVerification(true);
    } catch (err: any) {
      const message = err?.message || 'Unable to complete registration. Please check inputs and retry.';
      const duplicate = err?.status === 409 || message.toLowerCase().includes('already exists');
      setIsDuplicateEmail(duplicate);
      setDuplicateRequiresVerification(Boolean(err?.requiresVerification));
      setFormError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (verifyingFromLink || verifiedUser || alreadyVerifiedNotice || linkVerifyFailed) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-950 py-10 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-8 text-center space-y-5">
          {verifyingFromLink ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 mx-auto">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
                Verifying Your Account...
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Validating your email verification link and preparing your dashboard.
              </p>
            </>
          ) : alreadyVerifiedNotice ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
                Account Already Verified
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                Your email address has already been verified. Sign in with your email and password to open your dashboard.
              </p>
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl transition-colors inline-flex items-center justify-center gap-2"
              >
                <span>Go to Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : linkVerifyFailed ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 mx-auto">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
                Verification Link Issue
              </h1>
              <p className="text-xs sm:text-sm text-rose-700 dark:text-rose-300 font-medium">
                {formError || 'Verification link is invalid or has expired.'}
              </p>
              {resendSuccessMsg && (
                <div role="status" className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                  {resendSuccessMsg}
                </div>
              )}
              <form onSubmit={(e) => void handleVerifyCodeOrLink(e, recoveryEmail)} className="space-y-2.5 text-left pt-1 border-t border-slate-100 dark:border-slate-800">
                <label
                  htmlFor="recovery-code-or-link"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider pt-2"
                >
                  Verify Using 6-Digit Email Code or Copied Link
                </label>
                <input
                  id="recovery-email-for-otp"
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="Registered email (required for 6-digit code)"
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
                <input
                  id="recovery-code-or-link"
                  type="text"
                  value={otpOrLinkInput}
                  onChange={(e) => setOtpOrLinkInput(e.target.value)}
                  placeholder="Enter 6-digit code or paste Verify Me link"
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={verifyingCode || !otpOrLinkInput.trim()}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{verifyingCode ? 'Verifying...' : 'Verify & Open Dashboard'}</span>
                </button>
              </form>

              <div className="space-y-3 text-left pt-2 border-t border-slate-100 dark:border-slate-800">
                <label
                  htmlFor="recovery-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider"
                >
                  Or Request a New &ldquo;Verify Me&rdquo; Email
                </label>
                <input
                  id="recovery-email"
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="Enter your registered email"
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={isSubmitting || !recoveryEmail.trim()}
                  onClick={() => void handleResendVerification(recoveryEmail.trim().toLowerCase())}
                  className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmitting ? 'Sending Email...' : 'Resend "Verify Me" Email'}</span>
                </button>
              </div>
              <div className="flex items-center justify-center gap-4 pt-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setLinkVerifyFailed(false);
                    setFormError(null);
                  }}
                  className="text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  Register Again
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={onNavigateToLogin}
                  className="text-slate-600 dark:text-slate-400 hover:underline"
                >
                  Sign In
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
                Email Verified Successfully!
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Welcome, <strong className="text-slate-900 dark:text-slate-100">{verifiedUser?.displayName}</strong>! Opening your{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {roleDashboardLabels[(verifiedUser?.role as 'farmer' | 'trader' | 'analyst') || 'farmer']}
                </strong>
                ...
              </p>
              <button
                type="button"
                onClick={() => verifiedUser && onRegisterSuccess(verifiedUser)}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl transition-colors inline-flex items-center justify-center gap-2"
              >
                <span>Open My Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (pendingVerification) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-950 py-10 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 mx-auto">
            <Mail className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Check Your Registered Email
            </h1>
            {emailSentStatus ? (
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Welcome, <strong className="text-slate-900 dark:text-slate-100">{registeredName}</strong>! We sent both a{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">Verify Me</strong> button and a{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">6-digit code</strong> to{' '}
                <strong className="text-slate-900 dark:text-slate-100">{registeredEmail}</strong> to unlock your{' '}
                <strong className="text-slate-900 dark:text-slate-100">{roleDashboardLabels[registeredRole]}</strong>.
              </p>
            ) : (
              <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                Your account for <strong>{registeredEmail}</strong> was created, but the verification email could not be sent yet.{' '}
                {emailErrorMsg}
              </p>
            )}
          </div>

          {emailSentStatus && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-left text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              <strong className="text-slate-800 dark:text-slate-100">Testing inside AI Studio Dev Preview?</strong>{' '}
              Opening an <code className="text-[10px]">ais-dev</code> link directly from Gmail opens a restricted Google 403 tab. Enter the{' '}
              <strong>6-digit code</strong> from your email below (or paste the copied Verify Me link) to verify right here. On hosted sites (like Render), clicking <strong>Verify Me</strong> in your email works directly.
            </div>
          )}

          {formError && (
            <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-xs text-rose-700 dark:text-rose-300">
              {formError}
            </div>
          )}

          {resendSuccessMsg && (
            <div role="status" className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
              {resendSuccessMsg}
            </div>
          )}

          <form onSubmit={(e) => void handleVerifyCodeOrLink(e, registeredEmail)} className="space-y-2.5 text-left">
            <label
              htmlFor="verification-code-or-link"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider"
            >
              6-Digit Code or Copied Verify Me Link
            </label>
            <input
              id="verification-code-or-link"
              type="text"
              value={otpOrLinkInput}
              onChange={(e) => setOtpOrLinkInput(e.target.value)}
              placeholder="e.g. 482910 or paste full verification link"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={verifyingCode || !otpOrLinkInput.trim()}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2"
            >
              {verifyingCode ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verify &amp; Open {roleDashboardLabels[registeredRole]}</span>
                </>
              )}
            </button>
          </form>

          {!emailSentStatus && devVerifyToken && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-left space-y-2">
              <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
                Local Preview Notice (SMTP / Resend Not Configured)
              </p>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                Configure <code>RESEND_API_KEY</code> or <code>SMTP_*</code> to send real emails. In local dev mode, you can simulate clicking the emailed Verify Me link below:
              </p>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void completeEmailTokenVerification(devVerifyToken)}
                className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition-colors"
              >
                Simulate Emailed &ldquo;Verify Me&rdquo; Click (Dev Only)
              </button>
            </div>
          )}

          <div className="space-y-3 pt-1">
            <button
              type="button"
              onClick={() => void handleResendVerification(registeredEmail)}
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-800 dark:text-slate-100 font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending Verify Me Email...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Resend &ldquo;Verify Me&rdquo; Email &amp; Code</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onNavigateToLogin}
              className="w-full text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline pt-1"
            >
              Return to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-950 py-10 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="max-w-2xl w-full">
        {/* Header Branding */}
        <div className="text-center mb-6">
          <button
            type="button"
            onClick={onNavigateToHome}
            className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline mb-2.5"
          >
            <Sprout className="w-4 h-4" />
            <span>AgriMandi-AI Agricultural Platform</span>
          </button>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Create Verified Account
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Register below and verify via the <strong>Verify Me</strong> button or <strong>6-digit code</strong> sent to your email.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 sm:p-8">
          {formError && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-3"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <p className="text-xs sm:text-sm text-rose-700 dark:text-rose-300 font-medium">{formError}</p>
              </div>
              {isDuplicateEmail && (
                <div className="pl-8 flex flex-wrap items-center gap-2">
                  {duplicateRequiresVerification && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleResendVerification(email.trim().toLowerCase(), true)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Resend &ldquo;Verify Me&rdquo; Email &amp; Enter Code</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onNavigateToLogin}
                    className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg transition-colors"
                  >
                    Go to Sign In
                  </button>
                </div>
              )}
            </div>
          )}

          {resendSuccessMsg && (
            <div
              role="status"
              className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs sm:text-sm text-emerald-700 dark:text-emerald-300 font-medium"
            >
              {resendSuccessMsg}
            </div>
          )}

          <form onSubmit={handleSubmitRegistration} className="space-y-6">
            {/* 1. Full Name */}
            <div>
              <label
                htmlFor="reg-fullname"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Full Name *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  id="reg-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Ramesh Patel"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* 2. Role Selector */}
            <div>
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                Select Your Role *
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Account role">
                {[
                  { id: 'farmer', label: 'Farmer / FPO', desc: 'Sell crops at fair APMC rates', icon: Sprout },
                  { id: 'trader', label: 'Mandi Trader', desc: 'Track arrivals & spot margins', icon: Briefcase },
                  { id: 'analyst', label: 'Market Analyst', desc: 'Econometric & ML diagnostics', icon: GraduationCap },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected = role === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setRole(item.id as 'farmer' | 'trader' | 'analyst')}
                      className={`p-3.5 rounded-xl border text-left transition-colors ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={`w-4 h-4 ${isSelected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`} />
                        <span
                          className={`text-xs font-bold ${
                            isSelected ? 'text-emerald-900 dark:text-emerald-200' : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {item.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Primary State */}
            <div>
              <label
                htmlFor="reg-state"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Primary Operating State (28 States) *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <MapPin className="w-4 h-4" />
                </div>
                <select
                  id="reg-state"
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value as IndianState)}
                  className="w-full pl-9 pr-8 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                >
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st} ({STATE_METADATA[st]?.region} Zone)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 4. Email Address */}
            <div>
              <label
                htmlFor="reg-email"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Email Address *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="farmer@example.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* 5. Optional Phone Number */}
            <div>
              <label
                htmlFor="reg-phone"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
              >
                Phone Number (Optional)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Phone className="w-4 h-4" />
                </div>
                <input
                  id="reg-phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Optional contact number"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            {/* 6. Password & Confirm */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="reg-password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
                >
                  Password *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full pl-9 pr-10 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-confirm-password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
                >
                  Confirm Password *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="reg-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sending Verify Me Email...</span>
                </>
              ) : (
                <>
                  <span>Register &amp; Send Verify Me Email</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Already have an account?{' '}
              <button
                type="button"
                onClick={onNavigateToLogin}
                className="font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                Sign In here
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
