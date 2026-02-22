use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Soft cap cannot exceed hard cap")]
    SoftCapExceedsHardCap,
    #[msg("Start time must be before end time")]
    StartTimeAfterEndTime,
    #[msg("Start time cannot be in the past")]
    StartTimeInPast,
    #[msg("End time cannot be in the past")]
    EndTimeInPast,
    #[msg("Amount cannot be zero")]
    AmountCannotBeZero,
    #[msg("Hard cap cannot be zero")]
    HardCapCannotBeZero,
    #[msg("Cap cannot be 0")]
    CapCannotBeZero,
    #[msg("Price per token cannot be zero")]
    PricePerTokenCannotBeZero,
    #[msg("Not enough tokens to sell")]
    NotEnoughTokens,
    #[msg("Not enough SOL to buy tokens")]
    NotEnoughSOL,
    #[msg("ICO is not active")]
    ICOIsNotActive,
    #[msg("ICO is not ended")]
    ICOIsNotEnded,
    #[msg("ICO is not started")]
    ICOIsNotStarted,
    #[msg("ICO is already ended")]
    ICOIsAlreadyEnded,
    #[msg("ICO is already started")]
    ICOIsAlreadyStarted,
    #[msg("ICO hardcap reached")]
    ICOHardCapReached,
    #[msg("Creator mismatch")]
    CreatorMismatch,
    #[msg("Overflow")]
    Overflow
}
