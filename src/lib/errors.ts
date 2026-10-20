/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
