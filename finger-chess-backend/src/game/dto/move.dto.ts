import { IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';

export class MoveDto {
  @IsUUID()
  gameId: string;

  @IsString()
  @Matches(/^[a-hRNBQKO][a-h1-8x=+#O-]{0,7}$/, { message: 'Move must be valid SAN notation' })
  san: string;

  /**
   * The client's view of how many plies have been played. Lets the server
   * distinguish a duplicate/out-of-order delivery ("your board is behind the
   * server") from an actually-illegal move, giving the frontend a precise
   * recovery signal instead of a confusing "Not your turn".
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedMoveCount?: number;
}
