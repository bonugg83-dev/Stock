import { useState } from 'react';
import { useAppData } from '../../app/AppData';
import { downloadBackup, shouldRemindBackup, snoozeBackupReminder } from '../../db/backupFile';
import { Button, Notice } from './ui';

/** 백업이 없거나 오래됐을 때 대시보드 상단에 표시 */
export function BackupReminder() {
  const app = useAppData();
  const [show, setShow] = useState(shouldRemindBackup());
  if (!show) return null;
  return (
    <Notice tone="warning">
      <p className="font-medium">백업 파일을 아직 받지 않았거나 오래되었습니다.</p>
      <p className="mt-1 text-xs">
        기록은 이 브라우저에만 저장됩니다. 시크릿(사생활 보호) 모드, 브라우저 데이터 삭제, 다른 주소·다른 앱 내 브라우저로 접속하면 사라질 수 있습니다. 백업 파일이 있으면 언제든 복원할 수 있습니다.
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          className="px-3 py-1"
          onClick={async () => {
            await downloadBackup(app.today);
            setShow(false);
          }}
        >
          지금 백업 받기
        </Button>
        <Button
          variant="secondary"
          className="px-3 py-1"
          onClick={() => {
            snoozeBackupReminder();
            setShow(false);
          }}
        >
          7일 뒤에 알림
        </Button>
      </div>
    </Notice>
  );
}
