import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/account/auth-provider';
import { AccountNav } from '@/components/account/account-nav';

const BRAND_MARK_SRC = 'data:image/webp;base64,UklGRlQEAABXRUJQVlA4IEgEAADwEgCdASpAAD0APnk2lkgkoqIhLBVZmJAPCWwAnTKEfKyE7T/k93ZtRttfMB+tPrj+izeGN5Q/vnnARVEyZtPDJlbMz/yefT/sFJ1QdLUQGLKNZ42gQMYY3/8wBppMNDS6oJtt+qqppqixjYmf+3+vu3Lh/mDOCMZtNU3zh3eRnkTB7d+T5DqL13Xc8eC2M2jWL9MV3Uv/sBLVepuziCoAAP7/OchhQWgJwSMYpyD+nr+OOaDfDPWJDr3wedhzn3i8y2nCVGajOXiD5wvSufWrbn3GjeWYT+JRta/qjt+/7eDgiw+yt1hPhdGihb0q6KZ/w0H4R3ArOY0vCeAszG338nzJ7TOT1KMHFGbDkBAYo38a+jFa4/KxlX18vUZzCpseswcRHRdUH+x7e1MnFh9735wLleHxfNq29EY423COXkv5fucoIydkBhjaEFtyNxC/zk+H99NbrylzWdk2pKV/TkxwQDCvTu0niWFqev+eWFrBngWUotd5JOLR+fA8aOmcP0iqw/prcKe07/3vYpn+T4LYK71/5SvAb5Cr9JfbIHtSRhUK7gaF7D8pml0V3z5NbBA8UZiBczg/4bb3l2HqXYHXdtjSfm3OJnie7jiybl65u8sPV9cyE9MnSfs+wddO/mQrk8UNf+Tg5LDvltsn/sPqF+aPs7JMOoz7h9sdebDlFjgdk88kdGNxsyveDmOLgX4DuJ0JR9Db+sGxFul6cMd0chvuneoSWmrugrH4RBWWb96DEM6IBwQeROxHs9FyEe1e8zZMthohISHLQjfKa7pmzD1ZnUar0Q3+mKQn3+Uq/sn+mQz+KM1yd8Sua93ezqtf7VyQhqdZdIBp3nuvjPb0eof0PH5g/ND2x174UIda+5pvn2cpwuNYduMQdr5VMef4nlFgy0WZCSaoKe+8DIWcnkXsgM/nsTqPnjXmvr1Xt/cWXTxiT7JpkSaSLPTBfx/wHQ1Jdb7wYPXvO/WeMyO+Sbf7Ue4JjGJY+kv5oL8TsTVcfuAmRYlxeNmsEg8GQuM+Dfk/gug9TZJLCx8VTFBTG3pOOmx5bhHUjLDBHz0McuIZrVxvJ/lC7jR2Gs/nE2tDo2losWVWzcfj3/9MRiJ2nYbMybeXCkzhX+DkEvTzhqLjqxVv9/4+HFeihjM6NedSJEpOlEqMUBTick70yETDUfQcNkHYDIlmowHCO1nrk6/U2yYOY4kuReqC4E+tfbuIOQWIKc3swsyQfRaa/S3IfY8obomDL/EfbC9O2FI/ctUdIt82OgCdjkSlVpEW6ZZPjC6YGFmpF6LZg2b7KsoJ/gI589xbo1CvIuaU20iLlTsVx/50LhBsHNW4MpFbJSbbuAFFJHw/zHvhVsfR+41HqIVMj3qj5Hb1lfOkdq8/4C3i6jFwtSOvpq1CKf3XLNJ9IZz+kRnpYMmH753J9C9h5aVvTf9SAKtwVy8H2MQX+7pJUAAA';
const BRAND_WORDMARK_SRC = 'data:image/webp;base64,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';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="gv-app-shell">
        <header className="gv-header">
          <div className="gv-header__inner">
            <Link className="gv-brand" href="/" aria-label="Globevoy home">
              <img className="gv-brand__mark-image" src={BRAND_MARK_SRC} alt="" aria-hidden="true" />
              <img className="gv-brand__wordmark" src={BRAND_WORDMARK_SRC} alt="Globevoy" />
            </Link>
            <div className="gv-header__actions">
              <AccountNav />
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="gv-footer">
          <div className="gv-footer__inner">
            <div className="gv-footer__brand">
              <strong>Globevoy</strong>
              <span>See where your budget can take you.</span>
            </div>
            <p className="gv-footer__trust">Trip prices can change. Globevoy shows the evidence behind important prices and asks you to verify current availability before continuing with an external travel partner.</p>
          </div>
        </footer>
      </div>
    </AuthProvider>
  );
}
