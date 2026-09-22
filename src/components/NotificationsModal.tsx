import React from 'react';
import { useApp } from '../context/AppContext';
import { Bell, CheckCheck, Calendar, X } from 'lucide-react';

interface NotificationsModalProps {
  onClose: () => void;
  onViewAppointment?: (appointmentId: string) => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({ onClose, onViewAppointment }) => {
  const { notifications, currentUser, markNotificationsAsRead } = useApp();

  const userNotifications = notifications.filter(
    (n) => (currentUser ? n.userId === currentUser.id : true)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Bildirimler</h3>
              <p className="text-xs text-slate-500">{userNotifications.length} bildirim mevcut</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {userNotifications.some((n) => !n.read) && (
              <button
                onClick={markNotificationsAsRead}
                className="text-xs font-medium text-blue-700 hover:text-blue-800 flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <CheckCheck className="w-4 h-4" /> Tümünü Oku
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
          {userNotifications.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <Bell className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p className="font-medium text-slate-600">Henüz bir bildiriminiz yok</p>
              <p className="text-xs text-slate-400 mt-1">Randevu güncellemeleri burada listelenecektir.</p>
            </div>
          ) : (
            userNotifications.map((notif) => (
              <div
                key={notif.id}
                className={`p-4 transition-colors ${notif.read ? 'bg-white' : 'bg-blue-50/40'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${notif.read ? 'bg-transparent' : 'bg-blue-600'}`} />
                      <h4 className="text-sm font-semibold text-slate-900">{notif.title}</h4>
                      <span className="text-[11px] text-slate-400">{notif.date}</span>
                    </div>
                    <p className="text-xs text-slate-600 pl-4">{notif.message}</p>
                  </div>
                  {notif.appointmentId && onViewAppointment && (
                    <button
                      onClick={() => {
                        onViewAppointment(notif.appointmentId!);
                        onClose();
                      }}
                      className="text-xs font-semibold text-blue-700 bg-white border border-blue-200 px-2.5 py-1 rounded-lg hover:bg-blue-50 shrink-0"
                    >
                      Detay
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 text-center">
          <button
            onClick={onClose}
            className="w-full py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
