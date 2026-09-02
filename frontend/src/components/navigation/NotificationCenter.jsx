import React, { useState, useEffect, useRef } from 'react';
import { Bell, CheckCheck, Inbox, ShieldCheck, Trophy, Zap, AlertCircle } from 'lucide-react';

export default function NotificationCenter({
  notifications = [],
  onMarkAllAsRead = () => {},
  onSelectNotification = () => {},
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const popoverRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filteredNotifications = filter === 'unread'
    ? notifications.filter((n) => !n.read)
    : notifications;

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <div className="notification-center-wrap" ref={popoverRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        className={`topbar-icon-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Notifications"
        aria-label="View notifications"
        aria-expanded={isOpen}
      >
        <Bell className="w-4 h-4 text-slate-300" />
        {unreadCount > 0 && (
          <span className="notification-badge-pulse">{unreadCount}</span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="notification-popover-card" role="dialog" aria-label="Notifications Panel">
          <div className="notification-header">
            <div className="notification-header-title">
              <span className="font-bold text-sm text-slate-100">Notifications</span>
              {unreadCount > 0 && (
                <span className="notification-count-tag">{unreadCount} New</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="mark-all-read-btn"
                onClick={onMarkAllAsRead}
                title="Mark all as read"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark Read</span>
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="notification-filter-tabs">
            <button
              type="button"
              className={`filter-tab-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              className={`filter-tab-btn ${filter === 'unread' ? 'active' : ''}`}
              onClick={() => setFilter('unread')}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notification List / Empty State */}
          <div className="notification-body-list">
            {filteredNotifications.length === 0 ? (
              <div className="notification-empty-box">
                <div className="empty-icon-wrap">
                  <Inbox className="w-7 h-7 text-slate-500 opacity-70" />
                </div>
                <h4 className="empty-title">All Caught Up!</h4>
                <p className="empty-desc">
                  You have no unread notifications. Alerts for contest starts, rating calibrations, and verdict results will appear here.
                </p>
              </div>
            ) : (
              <ul className="notification-items-list" role="list">
                {filteredNotifications.map((n) => (
                  <li
                    key={n.id}
                    className={`notification-item ${!n.read ? 'unread' : ''}`}
                    onClick={() => {
                      onSelectNotification(n);
                      setIsOpen(false);
                    }}
                  >
                    <div className="notification-item-icon">
                      {n.type === 'contest' ? (
                        <Trophy className="w-4 h-4 text-amber-400" />
                      ) : n.type === 'rating' ? (
                        <Zap className="w-4 h-4 text-purple-400" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-blue-400" />
                      )}
                    </div>
                    <div className="notification-item-content">
                      <div className="notification-item-title">{n.title}</div>
                      <div className="notification-item-message">{n.message}</div>
                      <div className="notification-item-time">{n.time || 'Just now'}</div>
                    </div>
                    {!n.read && <div className="unread-dot"></div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
