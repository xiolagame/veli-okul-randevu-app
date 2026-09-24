import React from 'react';
import { useApp } from '../context/AppContext';
import { Bell, CheckCheck } from 'lucide-react';
import { Button, Dialog, EmptyState } from './ui';

interface NotificationsModalProps {
  onClose: () => void;
  onViewAppointment?: (appointmentId: string) => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({ onClose, onViewAppointment }) => {
  const { notifications, currentUser, markNotificationsAsRead } = useApp();
  const userNotifications = notifications.filter((notification) => currentUser ? notification.userId === currentUser.id : true);
  return <Dialog title="Bildirimler" description="Okulunuzdan ve görüşmelerinizden haberler." onClose={onClose}>
    {userNotifications.some((notification) => !notification.read) && <Button variant="quiet" className="mb-4" onClick={markNotificationsAsRead}><CheckCheck size={18} />Tümünü okundu işaretle</Button>}
    {userNotifications.length ? <div className="divide-y divide-slate-200">{userNotifications.map((notification) => <article key={notification.id} className="py-4">
      <div className="flex items-start gap-3"><span className="avatar"><Bell size={19} /></span><div className="min-w-0"><h3 className="text-sm font-bold">{notification.title}{!notification.read && <span className="text-blue-700 text-xs ml-2">Yeni</span>}</h3><p className="text-sm text-slate-600 mt-2">{notification.message}</p><p className="text-xs text-slate-500 mt-2">{notification.date}</p>{notification.appointmentId && onViewAppointment && <Button variant="quiet" className="mt-2" onClick={() => { onViewAppointment(notification.appointmentId!); onClose(); }}>Randevuyu görüntüle</Button>}</div></div>
    </article>)}</div> : <EmptyState icon={Bell} title="Şimdilik her şey güncel" description="Randevu güncellemeleri burada görünecek." />}
  </Dialog>;
};
