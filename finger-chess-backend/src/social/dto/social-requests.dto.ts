import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendFriendRequestDto {
  @IsUUID()
  receiverId: string;
}

export class RespondFriendRequestDto {
  @IsIn(['accept', 'decline'])
  decision: 'accept' | 'decline';
}

export class BlockUserDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class SendMessageDto {
  @IsUUID()
  conversationId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}

export class StartConversationDto {
  @IsUUID()
  recipientId: string;
}

export class FileReportDto {
  @IsUUID()
  reportedUserId: string;

  @IsIn(['harassment', 'spam', 'impersonation', 'cheating', 'match_manipulation', 'inappropriate_content', 'other'])
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUUID()
  reportedMessageId?: string;
}

export class ReviewReportDto {
  @IsIn(['actioned', 'dismissed'])
  decision: 'actioned' | 'dismissed';
}

export class UpdatePrivacySettingsDto {
  @IsOptional()
  @IsIn(['everyone', 'friends', 'none'])
  whoCanMessage?: string;

  @IsOptional()
  @IsIn(['everyone', 'friends_of_friends', 'none'])
  whoCanFriendRequest?: string;

  @IsOptional()
  showOnlineStatus?: boolean;

  @IsOptional()
  showProfileStats?: boolean;

  @IsOptional()
  allowFriendSuggestions?: boolean;
}
