export interface MailMessage {
  seq: number;
  sender: string;
  receiver: string;
  content: string;
  task_id: string | null;
  created_at: number;
}
