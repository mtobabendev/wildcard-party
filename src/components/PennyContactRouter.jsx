import { useEffect, useRef, useState } from 'react';
import './PennyContactRouter.css';

const ROUTE_EVENT = 'wildcard:contact-route';
const TIMEOUT = 8000;
const contacts = { matt: 'Matt', kandy: 'Kandy', jenn: 'Jenn', penny: 'Penny', lucy: 'Lucy', erica: 'Erica' };

function isMessenger(href) {
  try { const url = new URL(href, window.location.href); return url.origin === 'https://party.wildcarddev.com' && url.searchParams.get('app') === 'messenger'; } catch { return false; }
}
function isContact(href) { return /^(mailto|tel|sms):/i.test(href) || isMessenger(href); }
function messageFor(href) {
  if (isMessenger(href)) return 'I’ll open WildCard Messenger for you.';
  if (/^mailto:/i.test(href)) {
    const name = contacts[href.slice(7).split('@')[0].toLowerCase()];
    return name ? 'I’ll get your message ready for ' + name + '.' : 'I’ll get your message ready.';
  }
  return /^sms:/i.test(href) ? 'I’ll open your text message.' : 'I’ll put you through.';
}

export function requestContactRoute(href, message, fallbackType = '') {
  const event = new CustomEvent(ROUTE_EVENT, { cancelable: true, detail: { href, message, fallbackType } });
  if (window.dispatchEvent(event)) window.location.href = href;
  return true;
}

export default function PennyContactRouter({ videoSource }) {
  const dialog = useRef(null);
  const video = useRef(null);
  const pending = useRef(null);
  const timer = useRef(0);
  const serial = useRef(0);
  const [route, setRoute] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stop = () => {
      window.clearTimeout(timer.current);
      timer.current = 0;
      const node = video.current;
      if (node) { node.pause(); node.removeAttribute('src'); node.load(); }
    };
    const finish = id => {
      if (pending.current?.id !== id || pending.current.finished) return;
      pending.current.finished = true;
      stop();
      setReady(true);
    };
    const begin = (details, source) => {
      if (pending.current) return;
      const next = { ...details, id: ++serial.current, source };
      pending.current = next;
      setReady(false);
      setRoute(next);
      const modal = dialog.current;
      if (!modal?.open) modal?.showModal();
      const node = video.current;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !node || !videoSource) { finish(next.id); return; }
      node.src = videoSource;
      node.muted = false;
      node.volume = 1;
      timer.current = window.setTimeout(() => finish(next.id), TIMEOUT);
      try { node.play()?.catch(() => finish(next.id)); } catch { finish(next.id); }
    };
    const onRequest = event => {
      if (!isContact(event.detail?.href || '')) return;
      event.preventDefault();
      begin(event.detail, document.activeElement);
    };
    const onLink = event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor || anchor.closest('[data-contact-router]') || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href') || '';
      if (!isContact(href)) return;
      event.preventDefault();
      begin({ href, message: messageFor(href), target: anchor.target, fallbackType: '' }, anchor);
    };
    const onEnd = () => { if (pending.current) finish(pending.current.id); };
    const onClose = () => {
      const previous = pending.current;
      pending.current = null;
      serial.current++;
      stop();
      setRoute(null);
      setReady(false);
      previous?.source?.focus?.();
    };
    const node = video.current;
    const modal = dialog.current;
    window.addEventListener(ROUTE_EVENT, onRequest);
    document.addEventListener('click', onLink);
    node?.addEventListener('ended', onEnd);
    node?.addEventListener('error', onEnd);
    modal?.addEventListener('close', onClose);
    return () => {
      window.removeEventListener(ROUTE_EVENT, onRequest);
      document.removeEventListener('click', onLink);
      node?.removeEventListener('ended', onEnd);
      node?.removeEventListener('error', onEnd);
      modal?.removeEventListener('close', onClose);
      pending.current = null;
      stop();
      if (modal?.open) modal.close();
    };
  }, [videoSource]);

  const close = () => dialog.current?.close();
  return (
    <dialog ref={dialog} className="penny-route-dialog" data-contact-router aria-label="Penny contact assist">
      <button type="button" className="penny-route-close" onClick={close} aria-label="Cancel routing">×</button>
      <div className="penny-route-video" hidden={ready}><video ref={video} playsInline preload="none" aria-hidden="true" /></div>
      <div className="penny-route-copy">
        <strong>♠ Penny · Contact Assist</strong>
        <p role="status">{route?.message}</p>
        {route && <div className="penny-route-actions">
          <a href={route.href} target={route.target || undefined} rel={route.target === '_blank' ? 'noopener noreferrer' : undefined} onClick={close}>{ready ? 'Continue' : 'Skip animation & continue'}</a>
          {route.fallbackType === 'penny-phone' && <a href="sms:+14029150789" onClick={close}>Text Penny</a>}
        </div>}
      </div>
    </dialog>
  );
}
