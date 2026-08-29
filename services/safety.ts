import { supabase } from '@/lib/supabase';
import { BlockedUser, SafetyReportCategory } from '@/types/safety';

export const SAFETY_REPORT_DETAILS_MAX_LENGTH = 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BlockedUserRow = {
  avatar_url?: unknown;
  created_at?: unknown;
  display_name?: unknown;
  user_id?: unknown;
  username?: unknown;
};

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function readErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requiredText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBlockedUser(row: BlockedUserRow): BlockedUser | undefined {
  const id = isUuid(row.user_id) ? row.user_id : undefined;
  const displayName = requiredText(row.display_name);
  const blockedAt =
    typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at))
      ? row.created_at
      : undefined;

  if (!id || !displayName || !blockedAt) return undefined;
  return {
    avatarUrl: optionalText(row.avatar_url),
    blockedAt,
    displayName,
    id,
    username: optionalText(row.username),
  };
}

function validateTargetId(targetUserId: string) {
  if (!isUuid(targetUserId)) throw new Error('invalid_target');
}

function normalizeDetails(details?: string): string | null {
  const trimmed = details?.trim() ?? '';
  if (trimmed.length > SAFETY_REPORT_DETAILS_MAX_LENGTH) throw new Error('invalid_details');
  return trimmed.length > 0 ? trimmed : null;
}

export async function blockUser(targetUserId: string): Promise<void> {
  validateTargetId(targetUserId);
  const { error } = await supabase.rpc('block_user', { target_user_id: targetUserId });
  if (error) throw error;
}

export async function unblockUser(targetUserId: string): Promise<void> {
  validateTargetId(targetUserId);
  const { error } = await supabase.rpc('unblock_user', { target_user_id: targetUserId });
  if (error) throw error;
}

export async function listBlockedUsers(): Promise<BlockedUser[]> {
  const { data, error } = await supabase.rpc('list_blocked_users');
  if (error) throw error;

  return ((data ?? []) as BlockedUserRow[])
    .map(parseBlockedUser)
    .filter((row): row is BlockedUser => row !== undefined);
}

export async function reportFriendMessage(
  messageId: string,
  category: SafetyReportCategory,
  details?: string,
): Promise<string> {
  if (!isUuid(messageId)) throw new Error('invalid_target');
  const { data, error } = await supabase.rpc('report_friend_message', {
    category,
    details: normalizeDetails(details),
    message_id: messageId,
  });
  if (error) throw error;
  if (!isUuid(data)) throw new Error('invalid_report_response');
  return data;
}

export async function reportUser(
  targetUserId: string,
  category: SafetyReportCategory,
  details?: string,
): Promise<string> {
  validateTargetId(targetUserId);
  const { data, error } = await supabase.rpc('report_user', {
    category,
    details: normalizeDetails(details),
    target_user_id: targetUserId,
  });
  if (error) throw error;
  if (!isUuid(data)) throw new Error('invalid_report_response');
  return data;
}

export function isReportRateLimited(error: unknown): boolean {
  return readErrorMessage(error).includes('report_rate_limited');
}

export function isMessageNoLongerReportable(error: unknown): boolean {
  const message = readErrorMessage(error);
  return message.includes('message_not_found') || message.includes('message_not_reportable');
}
