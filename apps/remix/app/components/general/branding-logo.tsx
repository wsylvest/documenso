import LogoImage from '@documenso/assets/logo.png';
import type { ImgHTMLAttributes } from 'react';

export type LogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>;

/**
 * The SmartRoofing AI logo used as the application identity (headers, sign-in,
 * embeds). The source is a raster asset from smartroofing.ai, so it is rendered
 * as an `<img>`; size it with `h-*` classes and let the width follow.
 *
 * Documenso attribution spots ("Powered by") use `DocumensoLogo` instead.
 */
export const BrandingLogo = ({ className, ...props }: LogoProps) => {
  return <img src={LogoImage} alt="SmartRoofing AI" className={className} {...props} />;
};
