import { formatDateTime, formatDatesInText } from '../utils/dates';
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { Button, Dialog, EmptyState } from './ui';

interface NotificationsModalProps {
  onClose: () => void;
  onViewAppointment?: (appointmentId: string) => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({ onClose, onViewAppointment }) => {
  const { notifications, currentUser, currentMembership, markNotificationsAsRead, clearParentNotifications } = useApp();
  const [clearError, setClearError] = useState('');
  const userNotifications = notifications.filter((notification) => currentUser ? notification.userId === currentUser.id : true);
  return <Dialog title="Bildirimler" description="Okulunuzdan ve görüşmelerinizden haberler." onClose={onClose}>
    {clearError && <p role="alert" className="mb-3 text-sm text-red-700">{clearError}</p>}
    <div className="mb-4 flex flex-wrap gap-2">{userNotifications.some((notification) => !notification.read) && <Button variant="quiet" onClick={markNotificationsAsRead}><CheckCheck size={18} />Tümünü okundu işaretle</Button>}
    {currentMembership?.role === 'parent' && userNotifications.length > 0 && <Button variant="quiet" onClick={() => { if (window.confirm('Tüm bildirimleriniz listeden kaldırılacak. Bu işlem sistem kayıtlarını etkilemez.')) void clearParentNotifications().catch(() => setClearError('Bildirimler temizlenemedi. Lütfen tekrar deneyin.')); }}><Trash2 size={18} />Tüm bildirimleri sil</Button>}</div>
    {userNotifications.length ? <div className="divide-y divide-slate-200">{userNotifications.map((notification) => <article key={notification.id} className="py-4">
      <div className="flex items-start gap-3"><span className="avatar"><Bell size={19} /></span><div className="min-w-0"><h3 className="text-sm font-bold">{notification.title}{!notification.read && <span className="text-blue-700 text-xs ml-2">Yeni</span>}</h3><p className="text-sm text-slate-600 mt-2">{formatDatesInText(notification.message)}</p><p className="text-xs text-slate-500 mt-2">{formatDateTime(notification.date)}</p>{notification.appointmentId && onViewAppointment && <Button variant="quiet" className="mt-2" onClick={() => { onViewAppointment(notification.appointmentId!); onClose(); }}>Randevuyu görüntüle</Button>}</div></div>
    </article>)}</div> : <EmptyState icon={Bell} title="Şimdilik her şey güncel" description="Randevu güncellemeleri burada görünecek." />}
  </Dialog>;
};
